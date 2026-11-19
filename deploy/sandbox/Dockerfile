# Linux-Testlabor für Coder Ultimate: Ubuntu mit den üblichen Werkzeugen zum Testen von Programmen.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash coreutils findutils grep sed gawk make git jq sqlite3 curl ca-certificates unzip zip \
      python3 python3-pip python3-venv python3-tk nodejs npm gcc g++ golang-go default-jdk-headless ruby php-cli \
      xvfb imagemagick x11-utils x11-apps xdotool libgtk-3-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work
