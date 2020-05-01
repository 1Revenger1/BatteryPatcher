import { Method, OperatingRegion, DSDT, FieldUnit, ObjType } from "./DSDT";
import { writeFileSync } from "fs";

const HEADER = `DefinitionBlock("", "SSDT", 2, "GWYD", "BATT", 0) {`
const REHABMETHODS : string = `
    // ------------------------- Rehabman's Methods -------------------------
    
    // Status from two EC fields
    Method (B1B2, 2, NotSerialized) {
        Return(Arg0 | (Arg1 << 0x08))
    }

    // Status from four EC fields
    Method (B1B4, 4, NotSerialized)
    {
        Local0 = Arg3
        Local0 = Arg2 | (Local0 << 0x08)
        Local0 = Arg1 | (Local0 << 0x08)
        Local0 = Arg0 | (Local0 << 0x08)
        Return(Local0)
    }`
const REHABMETHODS_EC = `
    Scope ([[EC]]) {
        
        /*  Called from RECB, grabs a single byte from EC
        *  Arg0 - offset in bytes from zero-based EC
        */
        Method (RE1B, 1, NotSerialized)
        {
            OperationRegion(XXOR, EmbeddedControl, Arg0, 1)
            Field(XXOR, ByteAcc, NoLock, Preserve) { BYTE, 8 }
            Return(BYTE)
        }
        
        /*  Grabs specified number of bytes from EC
        *  Arg0 - offset in bytes from zero-based EC
        *  Arg1 - size of buffer in bits
        */
        Method (RECB, 2, Serialized)
        {
            Arg1 = Arg1 >> 0x03
            Name(TEMP, Buffer(Arg1) { })
            Arg1 = Arg0 + Arg1
            Local0 = 0
            While (Arg0 < Arg1)
            {
                Store(RE1B(Arg0), Index(TEMP, Local0))
                Arg0++
                Local0++
            }
            Return(TEMP)
        }
    }`;
const REHABMETHODS_END = `
    // ----------------------- End Rehabman's Methods ------------------------
`;
const EC_FIELD = `
    // ---------------------------- EC Fields --------------------------------`

export class SSDT {
    lines : string[] = [];
    
    filteredEC: OperatingRegion[];
    dsdt: DSDT;

    constructor(filteredEC: OperatingRegion[], toModify: Method[], dsdt: DSDT) {
        this.filteredEC = filteredEC;
        this.dsdt = dsdt;

        let EC_Prints : string[] = [];
        let MethodPrints : string[] = [];
        let ExternalPrints : string[] = [];
        // All modified field units across all EC regions/fields
        let modifiedEntryList = new Map<string, FieldUnit[]>();
        let takenNames : string[] = [];

        // Calculate modifications and new fields
        // Print out resulting new fields
        filteredEC.forEach((ec, ecIndex) => {
            ExternalPrints.push(`\tExternal (${ec.scope}, DeviceObj)`);
            EC_Prints.push(`\tScope (${ec.scope})\n\t{`);
            EC_Prints.push(`\t\tOperationRegion (X${ec.name.substring(1)}, EmbeddedControl, 0x00, 0x0100)`);

            let unmodifiedEC = dsdt.operatingRegions.get(ec.name);
            ec.fields.forEach((field, fieldIndex) => {
                // Find unmodified field to get offsets
                let unmodifiedField = unmodifiedEC!.fields.filter(unField => {
                    for (let fieldUnit of field.fieldUnits.values()) {
                        if (unField.fieldUnits.has (fieldUnit.name))
                            return true;
                    }
                    return false;
                })[0];

                let modifiedEntries = this.calculateMods(ecIndex, fieldIndex, takenNames);
                modifiedEntries.forEach((unit, key) => modifiedEntryList.set(key, unit));

                // If empty map then something is very very wrong
                if (modifiedEntries.size == 0) return;

                let tempBuffer = [];

                let offset = 0; // Offset of where we are in the field - This is in BYTES
                // Field unit size is in BITS (unless it's an Offset, which is in BYTES)

                tempBuffer.push(`\t\tField (X${ec.name.substring(1)}, ByteAcc, NoLock, Preserve)\n\t\t{`);

                let printOffset = true;

                unmodifiedField.fieldUnits.forEach (field => {

                    if (field.name.includes("Offset")) offset = field.size;
                    else if (modifiedEntries.has(field.name)) {
                        let mEnt = modifiedEntries.get(field.name);

                        // If over 32 bits, don't write but give it offset
                        // since we calculate offset here
                        if (mEnt![0].size > 32) {
                            mEnt![0].offset = offset;

                            offset += field.size / 8;
                            return;
                        }

                        if (printOffset) {
                            tempBuffer.push(`\t\t\tOffset (0x${offset.toString(16).toUpperCase()}),`);
                            printOffset = false;
                        }
                        mEnt!.forEach((newEntry, index) => {                          
                            tempBuffer.push(`\t\t\t${newEntry.name}, ${newEntry.size}, ${!index ? `// ${field.name}` : ""}`);
                        });
                        offset += field.size / 8;
                    } else {
                        offset += field.size / 8;
                        printOffset = true;
                    }

                });

                tempBuffer.push(`\t\t}`);
                if (fieldIndex != ec.fields.length - 1) tempBuffer.push("\t");
                // We also don't need to write fields over 32 bits to the files
                // Fields over 32 bits only have one replacement FieldUnit
                let nobelow32 = true;
                for(let field of modifiedEntries.values()) {
                    if (field.length >= 2) {
                        nobelow32 = false; 
                        break;
                    }
                }
                if (!nobelow32) EC_Prints.push(...tempBuffer);
            });
            EC_Prints.push(`\t}`);
        });

        let scope = "";
        let depth = 1;
        toModify = toModify.sort((a, b) => !a.scope ? 1 : !b.scope ? -1 : b.scope.localeCompare(a.scope));
        console.log(toModify.map(toModify => toModify.scope));
        
        toModify.forEach((method, methI) => {
            if(method.scope != scope) { 
                if (scope != "" && scope != "\\") {
                    // Replace new lines in previous line to clean up AESTHETICS at end of scopes
                    MethodPrints.push(MethodPrints.pop()!.replace("\n", ""));
                    MethodPrints.push(`\t}\n`);
                }
                if (method.scope != undefined && method.scope != "\\") {
                    MethodPrints.push(`\tScope(${method.scope})\n\t{`);
                    depth = 2;
                } else {
                    depth = 1;
                }

                scope = method.scope;
            }

            MethodPrints.push(`${this.tab(depth)}${method.header}`);
            
            let definedNames :string[] = [];
            method.lines.forEach(line => {
                let res;
                let extStr = "";

                if (line.includes("Name")) {
                    res = line.match(/(?<!0x)[0-9A-Z_]{2,4}($|(?=\))|(?![^ ]*(\.|\"))( \()?)/g);
                    definedNames.push(res![0]);
                }

                // Detect Externals...
                if (res = line.match(/(?<=Acquire \()[0-9a-zA-Z_]{1,4}/g)) {
                    let mut = dsdt.variable.get(res[0]);
                    if (mut!.type != ObjType.MutexObj) console.log("Incorrect Type - Mutex!");
                    extStr = (`\tExternal (${mut!.scope + "." + mut!.name}, MutexObj)`);
                    if (!definedNames.includes(mut!.name)
                     && !ExternalPrints.includes(extStr)) ExternalPrints.push(extStr);
                }

                if (res = line.match(/(?<!0x)[0-9A-Z_]{2,4}($|(?=\))|(?![^ ]*(\.|\"))( \()?)/g)) {
                    res.forEach(result => {
                        if (definedNames.includes(result)) return;
                        // Don't add modified FieldUnits to externals...
                        // Otherwise we defeat the entire point of this program
                        if (modifiedEntryList.has(result)) return;
                        // Dito for methods in the SSDT
                        if (toModify.filter(meth => meth.name == result).length) return;

                        if (result.includes(" (")) {
                            let method = dsdt.methods.get(result.split(" ")[0]);
                            if (method!.scope == undefined || method!.scope == "\\")
                                extStr = (`\tExternal (\\${method!.name}, MethodObj)`);
                            else extStr = (`\tExternal (${method!.scope + "." + method!.name}, MethodObj)`);
                        } else {
                            // Check Field Units first
                            // Then check Thermal Zones
                            // Then check Variables
                            // Then check devices
                            // Otherwise Unknown Obj

                            let orResult: FieldUnit | undefined;
                            let orScope: string | undefined;

                            dsdt.operatingRegions.forEach(or => {
                                or.fields.forEach(field => field.fieldUnits.forEach(fieldUnit => {
                                    if (fieldUnit.name == result) {
                                        orResult = fieldUnit;
                                        orScope = or.scope ? or.scope : "\\";
                                    }
                                }));
                            });

                            if (orResult && orScope)
                                extStr = (`\tExternal (${orScope + (orScope != "\\" ? "." : "") + orResult.name}, FieldUnitObj)`);
                            else if (dsdt.variable.has(result)) {
                                let variab = dsdt.variable.get(result);
                                // console.log(variab);
                                extStr = (`\tExternal (${(variab!.scope && variab!.scope != "\\" ? variab!.scope + ".": "\\") + variab!.name}, ${
                                    ObjType[variab!.type].toString()})`);
                            } else if (line.includes("Notify")) {
                                if (result == "_SB")
                                    extStr = (`\tExternal (\\_SB, DeviceObj)`);
                            } else if (!result.match(/^[A-F0-9]+$/g)) {
                                console.log("Unknown " + result);
                            }
                        }

                        if (extStr != "" && !ExternalPrints.includes(extStr)) ExternalPrints.push(extStr);
                    });
                }


                // Detect if there are any vars to replace
                res = line.match(/\[\[.*\]\]/g);
                
                // Replace them with methods then write to `line`
                // Sizes over 32 bits have helper methods which 
                // dynamically assign fields at the places needed
                // Sizes under 32 bits have helper functions w/ mult parameters
                if (res) {
                    res.forEach(match => {
                        match = match.replace(/(\[\[|\]\])/g, "")
                        let replace;
                        // Outside of scope - need to use full paths for everythings
                        if (match.includes(".")) {
                            let arr = match.split(".");
                            let trimmedStr = arr[arr.length - 1];
                            let scope = arr.slice(0, arr.length - 1).join(".") + ".";

                            replace = modifiedEntryList.get(trimmedStr);
                            
                            switch (replace!.length) {
                                case 1:
                                    line = line.replace(`[[${match}]]`,
                                        `${scope}RECB(0x${replace![0].offset!.toString(16).toUpperCase()}, ${replace![0].size})`);
                                    break;
                                case 2:
                                    line = line.replace(`[[${match}]]`,
                                        `B1B2(${scope + replace![0].name}, ${scope + replace![1].name})`);
                                    break;
                                case 4:
                                    line = line.replace(`[[${match}]]`,
                                        `B1B4(${scope + replace![0].name}, ${scope + replace![1].name}, ${scope + replace![2].name}, ${scope + replace![3].name})`)
                            }

                            line += ` // ${match}`
                        // else inside scope - can just use field unit name
                        } else {
                            replace = modifiedEntryList.get(match);
                            switch (replace!.length) {
                                // Greater than 32bits
                                case 1:
                                    line = line.replace(`[[${match}]]`, `RECB(0x${replace![0].offset!.toString(16).toUpperCase()}, ${replace![0].size})`);
                                    break;
                                case 2:
                                    line = line.replace(`[[${match}]]`, `B1B2(${replace![0].name}, ${replace![1].name})`);
                                    break;
                                case 4:
                                    line = line.replace(`[[${match}]]`, `B1B4(${replace![0].name}, ${replace![1].name}, ${replace![2].name}, ${replace![3].name})`)
                                    break;
                            }

                            line += ` // ${match}`
                        }

                    });
                }

                if (line.includes("{") && line.includes("}")) MethodPrints.push(`${this.tab(depth)}${line}`)
                else if (line.includes("{")) MethodPrints.push(`${this.tab(depth++)}${line}`);
                else if (line.includes("}")) MethodPrints.push(`${this.tab(--depth)}${line}`);
                else MethodPrints.push(`${this.tab(depth)}${line}`);
            });
            MethodPrints.push(`${this.tab(--depth)}}`)
            if (methI == toModify.length - 1 && method.scope && method.scope != "\\") MethodPrints.push(`${this.tab(--depth)}}\n`);
            else MethodPrints.push("");
        });

        // Sort Externals to similar type
        ExternalPrints = ExternalPrints.sort((a, b) => {
            let aTrim = a.replace(/(External|[ \(\)])/g, "").split(",");
            let bTrim = b.replace(/(External|[ \(\)])/g, "").split(",");

            if(a.length < 2 || b.length < 2) return -1;
            if (aTrim[1] == bTrim[1]) return aTrim[0].localeCompare(bTrim[0]);
            else return aTrim[1].localeCompare(bTrim[1]);
        });

        //Print SSDT
        this.lines.push(HEADER);

        this.lines.push(ExternalPrints.join("\n"));

        this.lines.push(REHABMETHODS);

        filteredEC.forEach(ec => {
            this.lines.push(REHABMETHODS_EC.replace("[[EC]]", ec.scope));
        });

        this.lines.push(REHABMETHODS_END);

        this.lines.push(EC_Prints.join("\n"));
        this.lines.push("");
        this.lines.push(MethodPrints.join("\n"));
        
        this.lines.push("}");

        console.log("Writing SSDT-BATT.dsl...");
        writeFileSync("../Results/SSDT-BATT.dsl", this.lines.join("\n"));
    }

    tab(depth: number) {
        return new Array(depth).fill("\t").join("");
    }

    calculateMods(ecIndex: number, fieldIndex: number, taken: string[]) : Map<string,FieldUnit[]> {
        let map = new Map<string,FieldUnit[]>();

        let toRename = this.filteredEC[ecIndex].fields[fieldIndex];

        toRename.fieldUnits.forEach(unit => {
            if (unit.size > 32) {
                map.set(unit.name, [{name: "GREATERTHAN32", size: unit.size }]);
            } else {
                let array = [];
                let newName = `${unit.name.charAt(0)}${unit.name.substring(2,4)}`;
                for (let i = 1; taken.includes(newName + "0"); i++) {
                    let changeIndex = i % 2 + 1;
                    newName = newName.substring(0, changeIndex) + String.fromCharCode(newName.charCodeAt(changeIndex) + 1) + newName.substring(changeIndex + 1);
                }
                
                taken.push(newName + "0");
                console.log("New name = " + newName);
            
                for (let i = 0; i < (unit.size > 16 ? 4: 2); i++) {
                    array.push({
                        name: `${newName}${i}`,
                        size: 8
                    })
                }

                map.set(unit.name, array);
            }
        });
         

        return map;
    }
}