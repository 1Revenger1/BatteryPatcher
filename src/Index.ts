import { accessSync, constants, readFileSync } from "fs";
import { spawnSync, execSync } from "child_process";
import { DSDT, OperatingRegion, Field, FieldUnit, OpRegTypes, Method } from "./DSDT";
import { SSDT } from "./SSDT";

process.chdir(__dirname);

// console.clear();

function header() {
    console.log(`+${new Array(27).fill("-").join("")}+`);
    console.log("|      Battery Patcher      |");
    console.log(`+${new Array(27).fill("-").join("")}+`);
    console.log(); //new line
}

class iASL {
    constructor() {
        try {
            accessSync("./Executables/iasl.exe", constants.R_OK);
        } catch (err) {
            // console.log(err);
            console.log("Need iASL");
            // process.exit(1);
        }
    }

    decompile (file : string) : boolean {
        try {
            accessSync("./Results/".concat(file, ".dat"), constants.R_OK | constants.W_OK);
            let prc = spawnSync ("./Executables/iasl", ["./Results/".concat(file, ".dat")]);
            return prc.status == 0;
        } catch (err) {
            console.log(err);
            return false;
        }
    }

    compile (file : string) {
        try {
            accessSync("./Results/".concat(file, ".dsl"), constants.R_OK);
        } catch (err) {

        }
    }

}

class acpiDump {
    constructor() {
        try {
            accessSync("./Executables/acpidump.exe", constants.R_OK);
        } catch (err) {
            // console.log(err);
            console.log("Need acpidump");
            // process.exit(1);
        }
    }

    dumpDsdt () : boolean {
        try {
            accessSync("./Results/DSDT.aml", constants.R_OK);
            let prc = execSync ("del .\\Results\\DSDT.aml");
            let prc2 = execSync ("del .\\Results\\dsdt.pre");
        } catch (err) {
            // No DSDT, no need to delete
        }

        // -o ./Results/DSDT.aml just generates an empty file
        // So change current working dir to avoid using -o
        let opts = [ "-n", "DSDT", "-b" ];
        let prc = spawnSync ("../Executables/acpidump.exe", opts, { cwd: "./Results" });
        if (prc.status) {
            console.log(prc.output[2].toString());
        }
        return prc.status == 0;
    }

}

async function prompt (question : string) : Promise<string> {
    let stdin = process.stdin;
    let stdout = process.stdout;

    stdin.resume();
    stdout.write(question.concat(": "));

    return new Promise ((res, rej) => {
        stdin.once('data', data => {
            stdin.pause();
            res(data.toString());
        });
    });
}

class BatteryPatcher {
    dumper = new acpiDump();
    iasl = new iASL();

    constructor() {
        // idk do constructy things
        // Maybe check and download for iASL?
    }

    async dumpDSDT() {
        console.clear();
        header();

        console.log("Dumping...");
        if(!this.dumper.dumpDsdt()) process.exit();
        console.log("Decompiling...");
        if(!this.iasl.decompile("dsdt")) process.exit();
        console.log(`DSDT is at ${__dirname}\\Results\\DSDT`);
        
        await new Promise(res => setTimeout(() => res(), 1000));
    }

    async crawler() {
        console.clear();
        header();

        try {
            let dsdtString = readFileSync("./Results/dsdt.dsl", { encoding: "UTF8" });
            let dsdt = new DSDT(dsdtString);

            let filteredECs : OperatingRegion[] = [];

            // Filter for fields above 8 bits
            dsdt.operatingRegions.forEach(rg => {
                if (rg.type != OpRegTypes.EmbeddedControl) return;
                let filteredRG = {
                    ...rg
                }

                filteredRG.fields = [];

                rg.fields.forEach(field => {
                    let filteredField = {
                        name: field.name,
                        fieldUnits: new Map<string, FieldUnit>()
                    }

                    field.fieldUnits.forEach(fieldObj => {
                        if (!fieldObj.name.includes("Offset") && fieldObj.size > 8)
                            filteredField.fieldUnits.set(fieldObj.name, fieldObj)
                    });

                    console.log(filteredField.fieldUnits);
                    filteredRG.fields.push(filteredField);
                });

                filteredECs.push(filteredRG);
                console.log(filteredRG);
            });

            let found = 0;

            let editedMethods : Method[] = [];

            // Loop again for methods
            dsdt.methods.forEach(method => { 
                let needsPatch = false;
                let editedMethod = {
                    ...method
                }

                editedMethod.lines = method.lines.slice(0);

                method.lines.forEach((line, lineNum) => {
                    
                    let scopeResults = undefined;
                    if (method.scope)
                        scopeResults = (method.scope + "." + method.name).match(/(H_EC|ECDV|PGEC|EC0|EC)/g);
                    let result;

                    // if (method.name == "GBIX") console.log(method.scope);
                    // If in the scope of EC, we have to check every line for references to field objs in EC fields
                    if (scopeResults && (result = this.matchEC(line, filteredECs))) {
                        line = line.replace(`${result}`, `[[${result}]]`);
                        console.log(`${method.name}, ${result}`);
                        needsPatch = true; 
                    // Outside of scope for EC, we can just check for references to EC
                    } else if (result = this.matchOutsideEC(line, filteredECs, lineNum)) {
                        result.forEach(str => {
                            line = line.replace(str, `[[${str}]]`)
                        });
                        needsPatch = true;
                    }

                    // Save away edited line
                    editedMethod.lines[lineNum] = line.trim();
                });

                if (needsPatch) editedMethods.push(editedMethod);
            });

            // Yeet we've got it all
            // Time to patch

            const ssdt = new SSDT(filteredECs, editedMethods, dsdt);

        } catch (err) {
            console.log(err);
            console.log(`Not able to find decompiled DSDT at ${__dirname}/Results/dsdt.dsl!`);
            process.exit();
        }


        await prompt("Press enter to continue...");

    }

    matchEC (line : string, filteredECs : OperatingRegion[]) : string | null {
        let splitLine : string[] = line
            .replace(/[,\(\)]/g, "")
            .trim()
            .split(/( |\.)/)
            .filter(string => 
                string.trim().length && string.trim().length < 5 && string.match(/[^a-z]+[A-Z]+/g)
            );

        if (splitLine.length == 0)
            return null;

        for(let result of splitLine) {
            if(this.checkFieldUnitExists(filteredECs, result)) {
                return result;
            };
        }

        return null;
    }

    matchOutsideEC(line : string, filteredECs : OperatingRegion[], lineNum : number) : string[] | null {
        let result = line.match(/(\\)?([0-9a-zA-Z_]{1,4}\.)+(H_EC|ECDV|PGEC|EC0|EC\.)([0-9a-zA-Z_]{1,4}($|(?= [^\.\(])))/g); 
        
        if(result==null)
            return null;

        let res = [];

        for(let string of result) {
            let array = string.replace(")", "").replace("=", "").replace("&", "").trim().split(".");
            let trimmedStr = array[array.length - 1];
            
            if (this.checkFieldUnitExists(filteredECs, trimmedStr)) {
                res.push(string);
            }
        }

        if (res.length) return res;
        else return null;
    }

    checkFieldUnitExists (orList: OperatingRegion[], check: string) : boolean {
        for (let or of orList) {
            for (let field of or.fields) {
                if (field.fieldUnits.has(check)) {
                    return true;
                }
            }
        }

        return false;
    }

    async main() {
        // good ol' while(true)
        while (true) {
            console.clear();
            header();

            console.log("1. Dump DSDT");
            console.log("2. Patch Battery");
            console.log("q. Quit");
            console.log(); // Newline

            let res = await prompt("Choose an option (q)");
            if(res.toLowerCase().startsWith("q")) break;
            if(res.toLowerCase().startsWith("1")) await this.dumpDSDT();
            if(res.toLowerCase().startsWith("2")) await this.crawler();
        }
    }
}

const patcher = new BatteryPatcher();
patcher.main();
