@echo off
setlocal
netsh advfirewall firewall add rule name="Molecule Builder 8000" dir=in action=allow protocol=TCP localport=8000 profile=private
pause
