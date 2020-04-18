# BatteryPatcher

Aims to dump DSDT and crawl through it for EC fields greater than 8 bits and create an SSDT for them.
This requires acpidump and iasl - make sure these are in your executables folder

## This should be ran in Windows or Linux, booted directly from your UEFI to make sure the DSDT is clean