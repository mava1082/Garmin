#!/bin/bash
# Dubbelklicka på den här filen för att starta dashboarden (Mac). Fungerar även på Linux.
cd "$(dirname "$0")" || exit 1

if [ ! -x .venv/bin/python ]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "Python saknas. Installera det från https://www.python.org/downloads/ och starta sedan den här filen igen."
    read -r -p "Tryck Enter för att stänga."
    exit 1
  fi
  echo "Förbereder första gången, det tar en eller ett par minuter..."
  python3 -m venv .venv || { read -r -p "Kunde inte förbereda Python. Tryck Enter för att stänga."; exit 1; }
fi

.venv/bin/python -m pip install -q --disable-pip-version-check -r requirements.txt || {
  echo "Installationen misslyckades. Kontrollera internetanslutningen och försök igen."
  read -r -p "Tryck Enter för att stänga."
  exit 1
}

.venv/bin/python -m garmin_dashboard --open
