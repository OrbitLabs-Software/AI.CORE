#!/usr/bin/env bash
# Legt die AI-Core-Modelle in Ollama unter eigenem Namen an (Einstellungen und Persönlichkeit fest eingebaut).
# Die Liste steht in models.list. Aufruf:
#   ./create-models.sh list            zeigt alle Modelle mit Speicherbedarf
#   ./create-models.sh aicore-coder    ein Modell anlegen (Basis wird geladen)
#   ./create-models.sh all             alle anlegen (lädt viele GB!)
#   DRY_RUN=1 ./create-models.sh X     zeigt nur das Modelfile, ohne etwas zu laden
set -euo pipefail
cd "$(dirname "$0")"

COMMON='Du bist AI Core, ein Assistent von OrbitLabs. Antworte auf Deutsch, außer die Frage ist in einer anderen Sprache. Sei klar, genau und freundlich. Fang mit der Antwort an, nicht mit Vorreden. Wenn du etwas nicht sicher weißt, sag es offen, statt zu raten. Wenn dich jemand fragt, welches Sprachmodell oder welche Technik hinter dir steckt, sag freundlich, dass du AI Core bist und dazu keine Angaben machst. Behaupte nie etwas Falsches über dich.'

profile_text() {
  case "$1" in
    denken)   echo 'Bei Rechenaufgaben und Logik denke Schritt für Schritt und prüfe das Ergebnis, bevor du antwortest.' ;;
    allround) echo 'Du bist ein vielseitiger Assistent für Fragen, Texte, Erklärungen und Planung. Gliedere längere Antworten klar. Nutze Listen nur, wenn sie helfen.' ;;
    flink)    echo 'Antworte kurz und schnell. Längere Erklärungen nur, wenn danach gefragt wird.' ;;
    coder)    echo 'Du bist ein erfahrener Programmierer. Schreibe vollständigen, lauffähigen Code in Markdown-Codeblöcken mit Sprachangabe (zum Beispiel ```python). Erkläre knapp, was der Code tut, und weise auf Grenzen und Fehlerfälle hin. Erfinde keine Funktionen oder Bibliotheken.' ;;
    vision)   echo 'Du kannst Bilder ansehen. Beschreibe zuerst genau, was du siehst, und beantworte dann die Frage dazu. Wenn etwas im Bild unleserlich ist, sag das.' ;;
    *)        echo '' ;;
  esac
}

modelfile() {   # modelfile BASIS TEMPERATUR KONTEXT PROFIL
  printf 'FROM %s\nPARAMETER temperature %s\nPARAMETER top_p 0.9\nPARAMETER repeat_penalty 1.08\nPARAMETER num_ctx %s\nSYSTEM """%s %s"""\n' "$1" "$2" "$3" "$COMMON" "$(profile_text "$4")"
}

want="${1:-list}"
[[ "$want" == list ]] && { column -t -s '|' <(grep -v '^#' models.list) 2>/dev/null || grep -v '^#' models.list; exit 0; }

found=0
while IFS='|' read -r name base temp ctx profile ram; do
  name="$(echo "$name" | xargs)"; [[ -z "$name" || "$name" == \#* ]] && continue
  base="$(echo "$base" | xargs)"; temp="$(echo "$temp" | xargs)"; ctx="$(echo "$ctx" | xargs)"; profile="$(echo "$profile" | xargs)"
  [[ "$want" != all && "$want" != "$name" ]] && continue
  found=1
  if [[ -n "${DRY_RUN:-}" ]]; then echo "### $name (Basis $base)"; modelfile "$base" "$temp" "$ctx" "$profile"; echo; continue; fi
  echo "==> $name aus $base"
  ollama pull "$base"
  modelfile "$base" "$temp" "$ctx" "$profile" > "/tmp/Modelfile.$name"
  ollama create "$name" -f "/tmp/Modelfile.$name"
done < models.list
[[ $found == 1 ]] || { echo "Unbekanntes Modell: $want (./create-models.sh list zeigt alle)"; exit 1; }
[[ -n "${DRY_RUN:-}" ]] || { echo "Fertig. Installierte Modelle:"; ollama list; }
