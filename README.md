# BatteryPatcher

## Archived in favor of [my new Lilu plugin](https://github.com/1Revenger1/ECEnabler)

Aims to dump DSDT and crawl through it for EC fields greater than 8 bits and create an SSDT for them.
This requires acpidump and iasl - make sure these are in your executables folder

* Dumps DSDT (Windows/Linux only)
* Creates an SSDT and set of method renames
  * This assumes that you do not rename your EC, and use a fake EC instead. Some devices (like Lenovo's) already have their EC named as EC, so those people do need need to worry.

### Dependencies
* NodeJS
* `npm install` should install all the dependecies other than iasl/acpidump
* You can get iasl/acpidump from your package manager in linux, or from [acpica](https://www.acpica.org/downloads/binary-tools)
  * MaciASL comes with iASL as well. I usually do `ln -s /Applications/MaciASL/Contents/macOS/iasl-stable /usr/local/bin` to symlink it into PATH
  * If your not putting iasl/acpidump in PATH, put it under ./Executables
  
### Running
`npm run start`
