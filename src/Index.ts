import { accessSync, constants, readFileSync, writeFileSync, fstat, existsSync } from "fs";
import { spawnSync, execSync } from "child_process";
import { DSDT, OperatingRegion, Field, FieldUnit, OpRegTypes, Method } from "./DSDT";
import { SSDT } from "./SSDT";
import * as plist from "plist";
import chalk from "chalk";

chalk.green("Hello");
process.chdir(__dirname);

// console.clear();

function header() {
    console.log(chalk.green(`+${new Array(27).fill("-").join("")}+`));
    console.log(chalk.green("|") + chalk.cyan("       9-bit Patcher       ") + chalk.green("|"));
    console.log(chalk.green(`+${new Array(27).fill("-").join("")}+`));
    console.log(); //new line
}

class iASL {
    executable: string;
    constructor() {
        this.executable = "./Executables/iasl";

        try {
            if (process.platform == "win32") {
                let res = execSync("which iasl");
                // TODO figure this out
            } else {
                let res = execSync("type iasl");
                if (res.toString().includes("is")) {
                    console.log("Found iASL in path");
                    this.executable = "iasl";
                }
            }

            if (this.executable.includes("\.")) {
                console.log(this.executable);
                accessSync(this.executable, constants.R_OK);
                console.log("Found under Executables");  
            }
        } catch (err) {
            console.log(err);
            console.log(chalk.red("Add iasl to the Executables folder OR add it to your PATH"));
            process.exit(1);
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
    executable: string;
    noDump: boolean;

    constructor() {
        this.executable = "./Executables/acpidump";
        this.noDump = true;
        try {
            // No acpidump for macOS
            if (process.platform == "darwin") return;
            if (process.platform == "win32") {
                let res = execSync("which acpidump");
                // TODO figure this out
            } else {
                let res = execSync("type acpidump");
                if (res.toString().includes("is")) {
                    console.log("Found acpidump in path");
                    this.executable == "acpidump";
                    this.noDump = false;
                }
            }


            if (this.executable.includes(".")) {
                accessSync(this.executable, constants.R_OK);
                console.log("Found under Executables");
                this.noDump = false;  
            }
        } catch (err) {
            console.log(err);
            // console.log(chalk.red("Add acpidump to the Executables folder OR add it to your PATH"));
            // process.exit(1);
        }
    }

    hasAcpiDump() : boolean {
        return !this.noDump;
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

    dsdtPath = "./Results/DSDT.dsl";

    constructor() {
        // idk do constructy things
        // Maybe check and download for iASL?
    }

    findDSDT (loc?: string) : Boolean {
        // if (loc) console.log(loc);
        return existsSync(loc ? loc : this.dsdtPath);
    }

    async changeDSDTLoc() {
        while (true) {
            console.clear();
            header();
            
            console.log("Enter in the location of your DSDT.aml\n");
            console.log(chalk.cyan("Windows Tip: ") + " Shift + Right click your DSDT.aml and click \"Copy Path\"");
            console.log(chalk.cyan("Linooox/macOS: ") + " Drag and drop your DSDT.aml into this prompt\n");

            let res = await prompt("New DSDT Location (q to go to the menu)");
            res = res.replace(/[\n\r]/g, "");
            if (res == "q") return;
            // console.log(res);
            if (this.findDSDT(res)) return this.dsdtPath = res;
            else {
                console.log(chalk.red("Could not find DSDT at ") + chalk.yellow(res) + chalk.red("!"));
                await new Promise(res => setTimeout(() => res(), 1000));
            }
        }
    }

    async dumpDSDT() {
        console.clear();
        header();

        console.log("Dumping...");
        if(!this.dumper.dumpDsdt()) process.exit();
        console.log(`DSDT is at ${__dirname}\\Results\\DSDT`);
        
        await new Promise(res => setTimeout(() => res(), 1000));
    }

    async decompile() {
        
    }

    async crawler() {
        console.clear();
        header();

        let dsdtString: string;
        let dsdt: DSDT;

        try {
            console.log("Decompiling...");
            if(!this.iasl.decompile("dsdt")) throw new Error("Not able to decompile DSDT");
            dsdtString = readFileSync("./Results/dsdt.dsl", { encoding: "UTF8" });
            dsdt = new DSDT(dsdtString);
        } catch (err) {
            console.log(err);
            console.log(`Not able to find decompiled DSDT at ${__dirname}/Results/dsdt.dsl!`);
            process.exit();
        }

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

        // Time to patch
        const ssdt = new SSDT(filteredECs, editedMethods, dsdt);

        let newPlist = {
            "ACPI":
            {
                "Patch": new Array<any>()
            }
        };

        console.log ("creating binary patches...");
        // Creating binary patches...
        editedMethods.forEach(method => {
            let newName = `X${method.name.substring(1)}`

            newPlist.ACPI.Patch.push(this.createPatch(method.name, newName, method));
        });

        let compPlist = plist.build(newPlist);
        writeFileSync("./Results/oc_patches", compPlist);

        await prompt(chalk.green("Finished! You'll find SSDT-BATT and a set of ACPI patches in the Results folder\n")
             + "Press enter to continue...");

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

    createPatch (from: string, string: string, method: Method) : {} {
        let patch =  {
            "Comment": `${from} to ${string} (EC Method Rename)`,
            "Enabled": true,
            "Find" : Buffer.alloc(from.length + 1),
            "Replace": Buffer.alloc(string.length + 1),
            "Count" : 0,
            "ReplaceMask": Buffer.from(""),
            "FindMask": Buffer.from("")
        }

        patch.Find.write(from);
        patch.Replace.write(string);

        patch.Find.writeInt8(parseInt(method.header.split(",")[1]), patch.Find.length - 1);
        patch.Replace.writeInt8(parseInt(method.header.split(",")[1]), patch.Replace.length - 1);

        return patch;
    }

    exit() {
        console.clear();
        header();

        console.log("This program can be found at: " + chalk.cyan("https://github.com/1Revenger1/BatteryPatcher"));
        console.log("Have a good day!");
        process.exit(0);
    }

    async main() {
        // good ol' while(true)
        while (true) {
            console.clear();
            header();

            console.log(chalk.cyan("1.") + " Change DSDT Location");
            console.log(chalk.cyan("2.") + " Patch Battery");
           
            if (this.dumper.hasAcpiDump()) {
                console.log(chalk.cyan("3.") + "Dump ACPI");
            } else if (process.platform != "darwin") {
                console.log(chalk.strikethrough.cyan("3.") + chalk.strikethrough("Dump ACPI")
                 + " - Missing acpidump! Make sure it's in PATH or /Executables");
            }
            
            console.log(chalk.cyan("q.") + " Quit");
            console.log(); // Newline

            let amlMsg;
            if (this.findDSDT()) amlMsg = chalk.green(this.dsdtPath);
            else amlMsg = chalk.green(this.dsdtPath) + chalk.red(" - DSDT not found.\n")
             + `Either place it under ${this.dsdtPath} or`
             + chalk.cyan("\n-") + " select \"Dump DSDT\" (Windows/Linux only)"
             + chalk.cyan("\n-") + " select \"Change DSDT Location\"\n";

            console.log(chalk.cyan`DSDT.aml Location: ` + amlMsg);
            console.log(`To refresh, press ${chalk.redBright("any key")} and press enter\n`);

            let res = await prompt("Choose an option (q)");
            if(res.toLowerCase().startsWith("q")) this.exit();
            if(res.toLowerCase().startsWith("1")) await this.changeDSDTLoc();
            if(res.toLowerCase().startsWith("2")) await this.crawler();
            if(res.toLowerCase().startsWith("3")) await this.dumpDSDT();
        }
    }
}
const patcher = new BatteryPatcher();
process.on("SIGINT", () => patcher.exit());
patcher.main();
