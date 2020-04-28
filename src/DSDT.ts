/*
 *  Based off of ACPI spec 6.3
 *  https://uefi.org/sites/default/files/resources/ACPI_6_3_May16.pdf
 */

export enum ObjType { 
    UnknownObj,
    IntObj,
    StrObj,
    BuffObj,
    PkgObj,
    FieldUnitObj,
    DeviceObj,
    EventObj,
    MethodObj,
    MutexObj,
    OpRegionObj,
    PowerResObj,
    ProcessorObj,
    ThermalZoneObj,
    BuffFieldObj,
    DDBHandleObj
}

export enum ORAccs {
    ByteAcc = 1,
    WordAcc = 2,
    DWordAcc = 4,
    QWordAcc = 8,
    BuffAcc = 16,
    AnyAcc = 32
}

export enum OpRegTypes {
    SystemMemory,
    SystemIO,
    PCI_Config,
    EmbeddedControl,
    SMBus,
    SystemCMOS,
    PciBarTarget,
    GeneralPurposeIO,
    GenericSerialBus,
    PCC
}

export enum OpRegAddrSpace {
    SystemMemory = ORAccs.ByteAcc | ORAccs.WordAcc
        | ORAccs.DWordAcc | ORAccs.QWordAcc | ORAccs.AnyAcc,
    SystemIO = SystemMemory,
    PCI_Config = SystemMemory,
    EmbeddedControl = ORAccs.ByteAcc,
    SMBus = ORAccs.BuffAcc,
    SystemCMOS = ORAccs.ByteAcc,
    PciBarTarget = SystemMemory,
    GeneralPurposeIO = ORAccs.ByteAcc,
    GenericSerialBus = ORAccs.BuffAcc,
    PCC = ORAccs.ByteAcc
}

export interface External {
    name: string,
    ObjType: ObjType
}

export interface Method {
    name: string,
    header: string,
    scope: string,
    lines: string[]
}

export interface FieldUnit {
    name: string,
    size: number,
    offset?: number
}

export interface Field {
    name: string,
    fieldUnits: Map<string, FieldUnit>
}

export interface OperatingRegion {
    name: string,
    type: OpRegTypes,
    fields: Field[],
    scope: string
}

export interface Variable {
    name: string,
    scope: string,
    type: ObjType
}

export class DSDT {

    methods : Map<string,Method> = new Map<string,Method>();
    operatingRegions : Map<string,OperatingRegion> = new Map<string,OperatingRegion>();
    variable : Map<string, Variable> = new Map<string, Variable>();

    constructor (dsdt : string) {
        let lines = this.pruneDSDT(dsdt);
        let depth = 0;
        let scopeStack : number[] = [];
        let scopeContext : string[] = [];

        let method : Method | null;
        let field : Field | null;

        let offsetIndex = 0;

        lines.forEach(line => {
            let res : string[] | null;
            
            if (line.includes("{")) depth++;
            if (line.includes("}")) {
                depth--;

                if (depth == 0) {
                    scopeContext.pop();

                    if (scopeStack.length < 1) return;
                    
                    depth = scopeStack.pop()!;
                    
                    if (method) {
                        this.methods.set (method.name, method);
                        method = null;
                    }
    
                    if (field) {
                        field = null;
                        return;
                    }
                }
            }

            if (method) {
                method.lines.push(line.trim());
            }

            if (field && line.trim() != "{") {
                let fieldUnit;
                if (line.includes("Offset")) {
                    fieldUnit = {
                        name: "Offset" + offsetIndex++,
                        size: parseInt(line.substring(line.indexOf("x") + 1, line.indexOf(")")), 16)
                    };
                } else { 
                    let lineSplit = line.trim().split(",");
                    if (lineSplit[0] == "") lineSplit[0] = "" + offsetIndex++;
                    fieldUnit = {
                        name: lineSplit[0],
                        size: parseInt(lineSplit[1])
                    };
                }

                field.fieldUnits.set(fieldUnit.name, fieldUnit);
                return;
            }

            if (res = line.match(/(?<=Scope \()\\?([0-9a-zA-Z_]{1,4}(\.)?)+/g)) {
                let name;
                if (!res[0].includes("\\"))
                    name = scopeContext[scopeContext.length - 1] + "." + res[0];
                else 
                    name = res[0];

                scopeContext.push(name);
                scopeStack.push(depth);
                depth = 0;
            }

            if (res = line.match(/(?<=Device \()[0-9a-zA-Z_]{1,4}/g)) {
                let name = scopeContext[scopeContext.length - 1] + "." + res[0];

                scopeContext.push(name);
                scopeStack.push(depth);
                depth = 0;
            }

            if (res = line.match(/(?<=Method \()[0-9a-zA-Z_]{1,4}/g)) {
                method = {
                    name: res[0],
                    lines : new Array(),
                    scope: scopeContext[scopeContext.length - 1],
                    header: line.trim()
                }

                scopeContext.push(scopeContext[scopeContext.length - 1] + "." + method.name);
                scopeStack.push(depth);
                depth = 0;
            }

            if (res = line.match(/(?<=OperationRegion \()[0-9a-zA-Z_]{1,4}/g)) {
                let splitLine = line.trim().split(",");
                let or = {
                    name: res[0],
                    // Use GenPurpIO to signify NoOp for now
                    type: splitLine[1].trim() == "EmbeddedControl" ? OpRegTypes.EmbeddedControl : OpRegTypes.GeneralPurposeIO,
                    fields: [],
                    scope: scopeContext[scopeContext.length - 1]
                }

                this.operatingRegions.set(or.name, or);
            }

            // We only care about EC for now...makes it simple to parse.
            // Possibly expand later?
            if ((res = line.match(/(?<= Field \()[0-9a-zA-Z_]{1,4}/g))
                && this.operatingRegions.has(res[0].trim())
                && this.operatingRegions.get(res[0].trim())!.type == OpRegTypes.EmbeddedControl) {
                
                // Yes, if we made it here it really exists...
                let or = this.operatingRegions.get(res[0].trim())!;
                let newField = {
                    name: res[0].trim(),
                    fieldUnits: new Map<string, FieldUnit>()
                }

                or.fields.push(newField);

                field = newField;
                // Yeah we don't care what this new scope it
                // Nothing should use it
                scopeContext.push("");
                scopeStack.push(depth);
                depth = 0;
            }

            // Ugh, time to figure out what this is...
            // We only need the type for battery patching
            // for the External field
            if ((res = line.match(/(?<=Name \()[0-9a-zA-Z_]{1,4}/g))
                && !res[0].startsWith("_")) {
                // Assume int unless we have reason to believe otherwise
                let variab : Variable = {
                    name: res[0],
                    type: ObjType.IntObj,
                    scope: scopeContext[scopeContext.length - 1]
                }

                if (line.includes("Buffer")) variab.type = ObjType.BuffObj;
                if (line.includes("Package")) variab.type = ObjType.PkgObj;
                if (line.toLowerCase().includes("eisaid")) {} // Int
                else if (line.includes("")) variab.type = ObjType.StrObj;
                if (line.includes("ResourceTemplate")) variab.type = ObjType.BuffObj;

                this.variable.set(variab.name, variab);
            }
            
            if (res = line.match(/(?<=ThermalZone \()[0-9a-zA-Z_]{1,4}/g)) {
                let variab : Variable = {
                    name: res[0],
                    type: ObjType.ThermalZoneObj,
                    scope: scopeContext[scopeContext.length - 1]
                }

                this.variable.set(variab.name, variab);
            }

            if (res = line.match(/(?<=Mutex \()[0-9a-zA-Z_]{1,4}/g)) {
                let variab : Variable = {
                    name: res[0],
                    type: ObjType.MutexObj,
                    scope: scopeContext[scopeContext.length - 1]
                }

                this.variable.set(variab.name, variab);
            }
        });

        console.log("Done discovering DSDT!");
    }

    pruneDSDT(dsdt: String) : string[] {
        let lines = dsdt.replace("\r", "").split("\n");
        // Strip Comments
        lines = lines.map(line => {
            if(line.includes("//")) {
                line = line.substring(0, line.indexOf("//"));
            }
            
            if(line.includes("/*")) {
                line = line.substring(0, line.indexOf("/*")) + line.substring(line.indexOf("*/") + 2);
            }
            return line;
        });

        return lines;
    }

}