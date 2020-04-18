import { accessSync, constants, readFileSync } from "fs";
import { spawnSync, execSync } from "child_process";

process.chdir(__dirname);

console.clear();

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
            console.log(err);
            console.log("Need iASL");
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
    constructor() {
        try {
            accessSync("./Executables/acpidump.exe", constants.R_OK);
        } catch (err) {
            console.log(err);
            console.log("Need acpidump");
            process.exit(1);
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
            let dsdt = readFileSync("./Results/dsdt.dsl", { encoding: "UTF8" }).split("\n");
            
            let scope = "";
            let ecName = "";
            let ECdevices : EC[] = [];
            let discoveringFields = false;
            let ECFields : OperatingRegion[] = [];
            let OperatingRegionName = "";
            
            // Loop once for EC device and for finding OperationRegions/fields
            dsdt.forEach((line, lineNumber) => {
                // Find LPC/LPCB Scope
                if(line.match(/.*Scope \(.*(LPC|LPCB)/g)) {
                    scope = line.substring(line.indexOf("(") + 1, line.indexOf(")"));
                }

                // Find EC Device (Probably don't need this though)
                if(line.match(/.*Device \((H_EC|ECDV|EC0|EC|PGEC)/g)) {
                    let name = line.substring(line.indexOf("(") + 1, line.indexOf(")"));
                    ecName = name;
                }

                if(line.match(/.*OperationRegion.*EmbeddedControl/g)) {
                    console.log("Discovered new OperationRegion");
                    let name = line.substring(line.indexOf("(") + 1, line.indexOf(","));
                    ECFields.push({
                        name: name,
                        ec: { scope: scope, name: ecName },
                        header: line.trim().replace(name, "[[REGION-NAME]]"),
                        fields: []
                    });
                }

                if(line.match(/.*Field*/)) {
                    // Check if it's for any Operating regions we've found
                    ECFields.forEach((reg, i) => {
                        let name = line.substring(line.indexOf("(") + 1, line.indexOf(","))
                        if (name == reg.name) {
                            console.log(`Found Field: ${name}`);
                            reg.fields.push({
                                header: line.trim().replace(name, "[[REGION-NAME]]"),
                                fieldsobs: []
                            });

                            // Continue iterating until we reach the end of the field block
                            // and put them under a new Field in this Operating Region
                            discoveringFields = true;
                            OperatingRegionName = name;
                        }
                    });
                }

                if(discoveringFields) {
                    if(line.includes("}")) discoveringFields = false;
                    else if(line.match(/.*(Field|\{)/g)) { /* do nothing */ }
                    else {
                        // Check that we're adding to the right Operating Region
                        ECFields.forEach(reg => {
                            if(OperatingRegionName == reg.name) {
                                // Field we are pushing into will always be the last one
                                // Fields and FieldObjs are pushed into in the order they are found in the DSDT
                                let field: FieldObj;
                                if (line.includes("Offset")) {
                                    field = {
                                        name: "Offset",
                                        size: parseInt(line.substring(line.indexOf("x") + 1, line.indexOf(")")), 16)
                                    };
                                } else { 
                                    let lineSplit = line.trim().split(",");
                                    field = {
                                        name: lineSplit[0],
                                        size: parseInt(lineSplit[1])
                                    };
                                }

                                reg.fields[reg.fields.length - 1].fieldsobs.push(field);

                                console.log(`Found Field (${field.name}, ${field.size.toString(16)})`)
                            }
                        });
                    }
                }
            });

            let filteredECs : OperatingRegion[] = [];

            // Filter for fields above 8 bits
            ECFields.forEach(rg => {

                let filteredRG = {
                    ...rg
                }

                filteredRG.fields = [];

                rg.fields.forEach(field => {
                    let filteredField = {
                        header: field.header,
                        fieldsobs: field.fieldsobs.filter(fieldObj => {
                            return fieldObj.name != "Offset" && fieldObj.size > 8
                        })
                    }
                    filteredRG.fields.push(filteredField);
                });

                filteredECs.push(filteredRG);
                console.log(filteredRG);
            });

            // Loop again for methods
            dsdt.forEach(line => {
                // Find LPC/LPCB Scope
                if(line.match(/.*Scope \(.*(LPC|LPCB)/g)) {
                    scope = line.substring(line.indexOf("(") + 1, line.indexOf(")"));
                }
                // If in the scope of EC, we have to check every line for references to field objs in EC fields
                if (scope.match(/.*(H_EC|ECDV|PGEC|EC0|EC)\)/g)) {

                // Outside of scope for EC, we can just check for references to EC
                } else if (line.match(/.*(H_EC|ECDV|PGEC|EC0|EC)/g)) {

                }

            });

            console.log(ECFields);

        } catch (err) {
            console.log(err);
            console.log(`Not able to find decompiled DSDT at ${__dirname}/Results/dsdt.dsl!`);
            process.exit();
        }
        await new Promise(res => setTimeout(() => res(), 1000));

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

interface EC {
    name: string,
    scope: string
}

interface OperatingRegion {
    name: string,
    ec: EC,
    header : string,
    fields : Field[]
}

interface Field {
    header: string,
    fieldsobs : FieldObj[];
}

interface FieldObj {
    name: string,
    size: number,
}

const patcher = new BatteryPatcher();
patcher.main();

