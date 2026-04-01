# Inicio rápido: modo autocontenido (Linux y Windows)

Esta guía amplía el [README principal](../README.md#inicio-rápido) con pasos **concretos** para usar el fork **Lightcode** en **Linux nativo** y en **Windows** (recomendado vía **WSL**), manteniendo todos los datos del CLI solo bajo **`<clon>/.local-opencode/`** y sin mezclarlos con una instalación global de OpenCode.

---

## 1. Qué es el modo autocontenido y por qué importa

| Concepto | Explicación |
|----------|-------------|
| **OpenCode “global”** | Si ejecutas `opencode` desde el `PATH` (npm, Homebrew, instalador, etc.), la app guarda config, caché y estado en **carpetas del usuario** (XDG en Linux, `%USERPROFILE%` en Windows, etc.). |
| **Fork autocontenido** | Con **`OPENCODE_PORTABLE_ROOT`** apuntando a **`<raíz-del-repo>/.local-opencode`**, solo se usan subcarpetas ahí (`data/`, `cache/`, `config/`, `state/`). Nada de eso contamina tu perfil global ni al revés. |
| **Script de arranque** | `scripts/opencode-isolated.sh` fija esa raíz, intenta enlazar **Node** para embeddings del router (Xenova), y **prefiere** el binario compilado en `packages/opencode/dist/opencode-*/bin/opencode` tras el build. |

**Regla práctica:** para este repo, no dependas del `opencode` global; arranca con el script aislado (o con las variables equivalentes que ves más abajo en PowerShell).

---

## 2. Requisitos previos (todas las plataformas)

1. **Git** — para clonar el repositorio.
2. **[Bun](https://bun.sh)** — el build y la toolchain del paquete `packages/opencode` lo usan (`bun run build -- --single`, `bun install`, etc.).
3. **Node.js** (recomendado) — el launcher y el worker de embeddings del router pueden invocar `node`. Si `node` está en el `PATH`, el script aislado exporta `OPENCODE_ROUTER_EMBED_NODE` automáticamente.
4. **Editor** — abre la **raíz del repositorio** como workspace (para `skills.paths` y `.opencode/opencode.jsonc`).

Instalación rápida de Bun (oficial):

```bash
curl -fsSL https://bun.sh/install | bash
```

Reinicia la terminal o sigue las instrucciones que imprime el instalador para añadir Bun al `PATH`.

---

## 3. Linux (nativo)

### 3.1 Clonar y entrar al repositorio

```bash
git clone <url-de-tu-fork-o-upstream> lightcode
cd lightcode
```

Usa la URL que corresponda (fork **commonriskpro** / **Lightcode** o el remoto que tengas).

### 3.2 Dependencias del monorepo

Desde la **raíz del repo** (ajusta si vuestro flujo usa solo `packages/opencode`):

```bash
bun install
```

Si algún paso de compilación nativa falla (poco frecuente), en distribuciones basadas en Debian suele ayudar tener herramientas de compilación básicas (`build-essential`) y `git`; en Fedora/RHEL, el grupo *Development Tools* o equivalente.

### 3.3 Compilar el binario local (una vez por máquina/arquitectura)

```bash
cd packages/opencode
bun run build -- --single
cd ../..
```

`--single` genera el binario para **tu** plataforma actual bajo algo como:

`packages/opencode/dist/opencode-linux-x64/bin/opencode`  
(El nombre exacto incluye arquitectura; puede variar, p. ej. `arm64`, `baseline`, etc.)

### 3.4 Arrancar en modo autocontenido

Desde la raíz del clon:

```bash
chmod +x scripts/opencode-isolated.sh   # solo la primera vez si no tiene bit de ejecución
./scripts/opencode-isolated.sh
```

Desde **cualquier directorio** (útil en alias o lanzadores):

```bash
/ruta/absoluta/a/lightcode/scripts/opencode-isolated.sh
```

**Qué ocurre:** se exporta `OPENCODE_PORTABLE_ROOT=<repo>/.local-opencode`, se ejecuta `packages/opencode/bin/opencode` (launcher en Node) y, si existe, se usa el binario de `dist/` como **`OPENCODE_BIN_PATH`** automáticamente.

### 3.5 Opcional: variables del fork en la shell

Si necesitas cargar `fork.opencode.env` manualmente (el launcher también puede resolver cosas al arrancar):

```bash
set -a && source ./fork.opencode.env && set +a
```

Para **no** cargar ese archivo: `OPENCODE_SKIP_FORK_ENV=1`.

### 3.6 Comprobar la raíz portable

Tras un primer arranque deberías ver creado (o en uso) el árbol bajo:

```text
<repo>/.local-opencode/
```

Ese directorio está en `.gitignore`; no se sube a Git.

---

## 4. Windows: enfoque recomendado — WSL 2

El script `opencode-isolated.sh` es **Bash**. El ecosistema OpenCode documenta también mejoras de rendimiento y compatibilidad usando **Linux dentro de Windows**. Por tanto:

1. Instala **[WSL 2](https://learn.microsoft.com/es-es/windows/wsl/install)** (Ubuntu u otra distro) siguiendo la guía de Microsoft.
2. Dentro de WSL, instala **Git**, **Bun** y **Node** como en la sección Linux.
3. Clona el repo en el sistema de archivos **de Linux** (p. ej. `~/proyectos/lightcode`) para evitar penalizaciones de I/O al compilar y ejecutar sobre `/mnt/c/...`. Si clonas en un disco Windows, accede desde WSL vía `/mnt/c/Users/...` sabiendo que puede ser más lento.
4. Ejecuta los mismos pasos que en [§3 Linux](#3-linux-nativo): `bun install`, `cd packages/opencode && bun run build -- --single`, luego `./scripts/opencode-isolated.sh` desde la raíz del clon.

**Proyectos en disco Windows:** WSL puede montar `C:` en `/mnt/c/`. Puedes trabajar ahí; solo ten presente posible lentitud en builds muy intensivos.

**Navegador en Windows:** Si más adelante usas `opencode web`, suele ser cómodo ejecutar el servidor en WSL y abrir `http://localhost:<puerto>` en el navegador de Windows (el propio upstream documenta este patrón).

---

## 5. Windows nativo (sin WSL): Git Bash o PowerShell

### 5.1 Git Bash

Si tienes [Git for Windows](https://git-scm.com/download/win), suele incluir **Git Bash**, un entorno Bash suficiente para:

```bash
cd /c/ruta/a/lightcode
./scripts/opencode-isolated.sh
```

Asegúrate de que **Bun** estás en el `PATH` que ve Git Bash (puedes añadir la ruta de instalación de Bun al `~/.bashrc` de Git Bash).

Si el script tiene finales de línea CRLF y falla con errores raros, normaliza a LF:

```bash
git config core.autocrlf false
# o re-checkout del archivo scripts/opencode-isolated.sh
```

### 5.2 PowerShell: equivalente manual del script

No hay `opencode-isolated.ps1` en el repo; puedes reproducir la idea fijando variables y llamando al launcher Node:

1. Abre PowerShell en la **raíz del clon** (sustituye la ruta):

```powershell
$root = "C:\ruta\a\lightcode"
$env:OPENCODE_PORTABLE_ROOT = "$root\.local-opencode"
```

2. Si tienes Node en el PATH y quieres el mismo criterio que el script Bash para embeddings:

```powershell
$n = Get-Command node -ErrorAction SilentlyContinue
if ($n) { $env:OPENCODE_ROUTER_EMBED_NODE = $n.Source }
```

3. Indica el binario compilado si la detección automática no aplica (ajusta carpeta `dist` al nombre real tras tu build):

```powershell
$env:OPENCODE_BIN_PATH = "$root\packages\opencode\dist\opencode-windows-x64\bin\opencode.exe"
```

En algunos builds el archivo puede llamarse `opencode` sin `.exe`; comprueba con el explorador de archivos o `Get-ChildItem ...\dist\opencode-*\bin`.

4. Lanza el launcher (Node ejecuta `packages/opencode/bin/opencode`):

```powershell
node "$root\packages\opencode\bin\opencode"
```

Puedes pasar argumentos al final (p. ej. `node ...\opencode tui` si tu flujo lo requiere).

**Nota:** El build `bun run build -- --single` en Windows debe ejecutarse en un entorno donde **Bun** esté instalado para Windows (no solo dentro de WSL). Si solo tienes Bun en WSL, es más simple seguir la [§4](#4-windows-enfoque-recomendado--wsl-2).

---

## 6. Variables útiles (resumen)

| Variable | Rol |
|----------|-----|
| `OPENCODE_PORTABLE_ROOT` | Raíz del árbol portable (debe apuntar a `<repo>/.local-opencode` o a la carpeta que quieras usar como sandbox). |
| `OPENCODE_BIN_PATH` | Ruta absoluta al binario compilado en `dist/.../bin/...` si quieres fijarlo a mano. |
| `OPENCODE_ROUTER_EMBED_NODE` | Ruta al ejecutable `node` para el worker de embeddings cuando el binario Bun no hereda un PATH completo. |
| `OPENCODE_SKIP_FORK_ENV` | `1` para no cargar `fork.opencode.env`. |

Detalle de comportamiento del launcher: comentarios en `scripts/opencode-isolated.sh` y en `packages/opencode/bin/opencode`.

---

## 7. MCP y config en modo portable

Con `OPENCODE_PORTABLE_ROOT` activo, la configuración “global” efectiva del portable es solo bajo **`OPENCODE_PORTABLE_ROOT/config/opencode/`**; no se mezcla con `~/.config/opencode` de la instalación global. Los MCP y ajustes deben vivir en el **repo** (`.opencode/opencode.jsonc`) y/o en la config bajo el árbol portable, según lo que documente el README del fork.

---

## 8. Problemas frecuentes

| Síntoma | Qué revisar |
|---------|-------------|
| `bun: command not found` | PATH tras instalar Bun; nueva sesión de terminal. |
| Build falla en Linux por dependencias nativas | Herramientas de compilación; volver a `bun install` en raíz y en `packages/opencode`. |
| El script no encuentra el binario en `dist/` | Ejecuta `bun run build -- --single` en `packages/opencode`; comprueba el nombre de la carpeta `opencode-*` y usa `OPENCODE_BIN_PATH`. |
| En Windows, `opencode.exe` vs `opencode` | Lista `packages/opencode/dist/opencode-*/bin/` y apunta `OPENCODE_ROUTER_EMBED_NODE` / `OPENCODE_BIN_PATH` al archivo que exista. |
| Mezcla de datos con OpenCode global | Comprueba que arrancas **solo** con el script aislado o con `OPENCODE_PORTABLE_ROOT` definido; no uses el `opencode` del PATH para este proyecto. |

---

## 9. Dónde seguir leyendo

- [README — Inicio rápido y “OpenCode global vs fork autocontenido”](../README.md#inicio-rápido)
- [README — Build y tests](../README.md#build-y-tests)
- [Guía 5W corta](LIGHTCODE-GUIA-5W.md) (enlace al README)

Rama de desarrollo por defecto del repo: **`dev`**.
