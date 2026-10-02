@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === Обновление сайта ===
echo.
git add -A
set /p MSG="Что изменилось (Enter - просто обновление): "
if "%MSG%"=="" set MSG=обновление
git commit -m "%MSG%"
git push
echo.
echo Готово. Сайт обновится за минуту-две:
echo https://rutasha2809-creator.github.io/crm-english-school/
echo.
pause
