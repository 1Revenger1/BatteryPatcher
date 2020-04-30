# BatteryPatcher

Aims to dump DSDT and crawl through it for EC fields greater than 8 bits and create an SSDT for them.
This requires acpidump and iasl - make sure these are in your executables folder

### This should be ran in Windows or Linux, booted directly from your UEFI to make sure the DSDT is clean
### This can be ran on macOS but you'll have to provide the DSDT.aml

### Dependencies
* NodeJS
* `npm install` should install all the dependecies other than iasl/acpidump
* `npm install -g typescript` to get the typescript compiler
* You can get iasl/acpidump from your package manager in linux, or from [acpica](https://www.acpica.org/downloads/binary-tools)
  * MaciASL comes with iASL as well. I usually do `ln -s /Applications/MaciASL/Contents/macOS/iasl-stable /usr/local/bin` to symlink it into PATH
  
### Running
`tsc && node ./out/Index.js`
