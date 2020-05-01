import { accessSync, constants, readFileSync, writeFileSync, fstat, existsSync } from "fs";
import { spawnSync, execSync } from "child_process";
import { DSDT, OperatingRegion, FieldUnit, OpRegTypes, Method } from "./DSDT";
import { SSDT } from "./SSDT";
import * as plist from "plist";
import chalk from "chalk";
import { resolve } from "path";

chalk.green("Hello");
process.chdir(__dirname);

try {
    accessSync("../Results", constants.R_OK | constants.W_OK);
} catch (err) {
    try {
        execSync("mkdir Results", { cwd: "../"});
    } catch (err) {
        console.log("Unable to make ../Results directory");
        process.exit();
    }
}

try {
    accessSync("../Executables", constants.R_OK | constants.W_OK);
} catch (err) {
    try {
        execSync("mkdir Executables", { cwd: "../"});
    } catch (err) {
        console.log("Unable to make ../Executables directory");
        process.exit();
    }
}

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
        this.executable = "../Executables/iasl";

        try {
            let res = spawnSync(
                process.platform == "win32" ? "where" : "which",
                ["iasl"]);
            if (res.status == 0) {
                console.log("Found iASL in path");
                this.executable = "iasl";
            }

            if (this.executable.includes("\.")) {
                accessSync(this.executable + (process.platform == "win32" ? ".exe" : ""), constants.R_OK);
                console.log("Found under Executables");  
            }
        } catch (err) {
            console.log(chalk.red("iASL not found!\n") + "Add iasl to the Executables folder OR add it to your PATH");
            process.exit(1);
        }
    }

    decompile (file : string) : boolean {
        try {
            accessSync(file, constants.R_OK | constants.W_OK);
            let prc = spawnSync (this.executable, [file]);
            return prc.status == 0;
        } catch (err) {
            console.log(err);
            return false;
        }
    }

    compile (file : string) : boolean {
        try {
            accessSync("../Results/".concat(file, ".dsl"), constants.R_OK);
        } catch (err) {
            console.log("Unable to find SSDT to compile");
            return false;
        }

        let prc = spawnSync (this.executable, [`../Results/${file}.dsl`]);
        if (prc.stderr && prc.status) { 
            console.log(prc.stderr.toString());
            console.log("Unable to compile SSDT-BATT!");
            return false;
        }
        return true;
    }

}

class acpiDump {
    executable: string;
    noDump: boolean;

    constructor() {
        this.executable = "../Executables/acpidump";
        this.noDump = true;
        try {
            // No acpidump for macOS
            if (process.platform == "darwin") return;
            let res = spawnSync(
                process.platform == "win32" ? "where" : "which",
                ["acpidump"]);
            if (res.status == 0) {
                console.log("Found acpidump in path");
                this.executable = "acpidump";
                this.noDump = false;
            }

            if (this.executable.includes("\.")) {
                accessSync(this.executable + (process.platform == "win32" ? ".exe" : ""), constants.R_OK);
                console.log("Found acpidump under Executables");
                this.noDump = false;  
            }
        } catch (err) {
            // console.log(err);
            console.log(chalk.yellow("ACPIDump not found!\n") + "ACPIDump is needed for dumping ACPI in Windows/Linux\nAdd acpidump to the Executables folder OR add it to your PATH");
            // process.exit(1);
        }
    }

    hasAcpiDump() : boolean {
        return !this.noDump;
    }

    dumpDsdt () : boolean {
        try {
            if (process.platform == "win32")
                execSync("del ..\\Results\\dsdt.*");
            else execSync("rm ../Results/dsdt.*");
        } catch (err) {
            // No DSDT, no need to delete
        }

        // -o ./Results/DSDT.aml just generates an empty file
        // So change current working dir to avoid using -o
        let opts = [ "-n", "DSDT", "-b" ];

        if (process.platform != "win32") {
            console.log("acpidump requires elevated privileges to dump, you may be asked to enter a password");
            opts.unshift(this.executable);
        }

        let prc = spawnSync (process.platform == "win32" ? this.executable : "sudo", opts, { cwd: "../Results" });
        
        if (prc.status) {
            console.log(prc.stderr.toString());
            return false;
        }
        if (process.platform == "win32") execSync("move dsdt.dat DSDT.aml", { cwd: "../Results"});
        else execSync("mv dsdt.dat DSDT.aml", { cwd: "../Results"});
        return true;
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

    dsdtPath = "../Results/DSDT.aml";

    constructor() {
        // idk do constructy things
        // Maybe check and download for iASL?
    }

    findDSDT (loc?: string) : Boolean {
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
            console.log(res);
            if (this.findDSDT(res)) return this.dsdtPath = res;
            else {
                console.log(chalk.red("Could not find DSDT at ") + chalk.yellow(resolve(res)) + chalk.red("!"));
                await prompt("jfdk");
                //await new Promise(res => setTimeout(() => res(), 1000));
            }
        }
    }

    async dumpDSDT() {
        console.clear();
        header();

        if (!this.dumper.hasAcpiDump()) {
            console.log(`${chalk.red("No acpidump!")}\nMake sure you have acpidump either in your PATH or under ./Executables`);
            await prompt("Press enter to continue...");
        }

        console.log("Dumping...");
        if(!this.dumper.dumpDsdt()) {
            console.log("An error occured dumping your DSDT...");
            console.log("Note for those using WSL that acpidump won't work in WSL");
            await prompt ("Press enter to continue...");
            return;
        }

        console.log(chalk.green("Success!"));
        console.log(`DSDT is at ${chalk.cyan(resolve(this.dsdtPath.replace(/(\.aml|\.dat)/g, ".dsl")))}`);
        
        await prompt("Press enter to continue...");
    }

    async crawler() {
        console.clear();
        header();

        let dsdtString: string;
        let dsdt: DSDT;

        try {
            console.log("Decompiling...");
            if(!this.iasl.decompile(this.dsdtPath)) throw new Error("Not able to decompile DSDT");
            dsdtString = readFileSync(this.dsdtPath.replace(/(\.aml|\.dat)/g, ".dsl"), { encoding: "UTF8" });
            dsdt = new DSDT(dsdtString);
        } catch (err) {
            console.log(err);
            console.log(`Not able to find decompiled DSDT at ${resolve(this.dsdtPath)}`);
            await prompt("Press enter to continue...");
            return;
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

        console.log ("Creating binary patches...");
        // Creating binary patches...
        editedMethods.forEach(method => {
            let newName = `X${method.name.substring(1)}`

            newPlist.ACPI.Patch.push(this.createPatch(method.name, newName, method));
        });

        let compPlist = plist.build(newPlist);
        writeFileSync("../Results/oc_patches.plist", compPlist);

        if (!this.iasl.compile("SSDT-BATT")) {
            await prompt("Press enter to continue...");
        } else {
            await prompt(chalk.green("Finished! You'll find SSDT-BATT and a set of ACPI patches in the Results folder\n")
            + "Press enter to continue...");
        }
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
                console.log(chalk.cyan("3.") + " Dump ACPI");
            } else if (process.platform != "darwin") {
                console.log(chalk.strikethrough.cyan("3.") + chalk.strikethrough(" Dump ACPI")
                 + " - Missing acpidump! Make sure it's in PATH or /Executables");
            }
            
            console.log(chalk.cyan("q.") + " Quit");
            console.log(); // Newline

            let amlMsg;
            if (this.findDSDT()) amlMsg = chalk.green(resolve(this.dsdtPath));
            else amlMsg = chalk.green(resolve(this.dsdtPath)) + chalk.red(" - DSDT not found.\n")
             + `Either place it under ${resolve(this.dsdtPath)} or`
             + chalk.cyan("\n-") + " select \"Dump DSDT\" (Windows/Linux only)"
             + chalk.cyan("\n-") + " select \"Change DSDT Location\"\n";

            console.log(chalk.cyan('DSDT.aml location: ' + amlMsg));
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
