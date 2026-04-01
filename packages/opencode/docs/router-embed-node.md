# Router embed (Xenova) y binario de Node

## Qué hace el sistema

El **tool router** puede usar embeddings locales (`@huggingface/transformers` + ONNX). El proceso principal suele ser **Bun**; para evitar cargar `onnxruntime-node` en ese proceso, el código arranca un **subproceso Node** (`packages/opencode/script/router-embed-worker.ts`) vía `router-embed-ipc.ts`.

Ese subproceso **debe poder ejecutar** un intérprete `node` real con `tsx` y dependencias del paquete.

## Por qué falla con Nix / Home Manager

1. **Rutas en `/nix/store/...`**  
   Cada derivación tiene un hash. Tras **`nix-collect-garbage`**, actualizar el perfil o cambiar de generación, **una ruta antigua deja de existir** → `ENOENT` en `posix_spawn`.

2. **`OPENCODE_ROUTER_EMBED_NODE` o `process.execPath` obsoletos**  
   El launcher (`packages/opencode/bin/opencode`) puede exportar `OPENCODE_ROUTER_EMBED_NODE` = `process.execPath` del Node que lanzó el script. Si ese era un Node de Nix, la ruta es **un store path concreto**. Si ese store fue recolectado, **la variable queda apuntando a un fantasma**.

3. **`PATH` solo con un `node` roto**  
   Si el código devolvía el nombre **`node`** y el `PATH` resolvía a un **symlink** a un store borrado, el error mostraba el **path absoluto** en `/nix/store/...` aunque el código fuente dijera `"node"`.

## Qué hace el código ahora (resumen)

- Si `OPENCODE_ROUTER_EMBED_NODE` apunta a un path que **ya no existe**, se **borra** de `process.env` y se siguen los fallbacks (no se queda colgada una ruta vieja).
- Al **cargar** `router-embed-ipc.ts`, se **elimina** `OPENCODE_ROUTER_EMBED_NODE` si apunta a **`/nix/store/...`** o a un fichero inexistente (evita heredar de Cursor/IDE una ruta vieja).
- El launcher `packages/opencode/bin/opencode` **no** inyecta `OPENCODE_ROUTER_EMBED_NODE` cuando `process.execPath` es un binario bajo **`/nix/store/...`** (esas rutas pueden desaparecer con GC; el embed resuelve después vía perfil Home Manager o `PATH`).
- **`scripts/opencode-isolated.sh`**: antes de arrancar, si la variable apunta a `/nix/store/` o no es ejecutable, **la quita** y vuelve a fijarla con **`command -v node`** cuando haya.
- **No** se usa `realpath` para sustituir rutas de perfil (Home Manager, `~/.nix-profile`) por `/nix/store/...`: el hash del store puede desaparecer con GC; se deja el path del perfil para que el SO resuelva el symlink al ejecutar.
- Comprueba **existencia + ejecutabilidad** (`X_OK`) antes de aceptar una ruta.
- Si `OPENCODE_ROUTER_EMBED_NODE` está definida pero **el fichero no existe o no es ejecutable**, se **ignora** y se prueban fallbacks.
- Orden típico: variable de entorno (si válida) → rutas fijas (Homebrew, `/usr/bin`, perfiles Nix/Home Manager bajo `$HOME`) → **`command -v node`** con el `env` actual → **`sh -lc 'command -v node'`** (perfil tipo login).
- El **spawn** del worker usa un `env` donde se **elimina** una `OPENCODE_ROUTER_EMBED_NODE` inválida y se **fija** la ruta resuelta cuando es absoluta.

## Ruta fija en `fork.opencode.env` (recomendado en este fork)

En la raíz del repo, `fork.opencode.env` puede incluir:

`OPENCODE_ROUTER_EMBED_NODE=${XDG_STATE_HOME}/nix/profiles/home-manager/home-path/bin/node`

`${HOME}` y `${XDG_STATE_HOME}` se expanden al cargar `fork.opencode.env` (launcher `bin/opencode` y `loadForkEnvSync`). Si `XDG_STATE_HOME` no está definido, se usa `$HOME/.local/state` (convención XDG). En sistemas donde Home Manager vive bajo `~/state/...` (porque exportas `XDG_STATE_HOME=$HOME/state`), esa ruta coincide con el perfil real. Esa variable **siempre** se toma del archivo si está definida ahí, para que el entorno del IDE no deje una ruta vieja.

Si no usas Home Manager, comenta esa línea y pon la ruta absoluta de tu `node` (`which node`).

## Cómo dejarlo estable en tu máquina (Nix)

1. **Asegura un `node` usable en la sesión donde arrancas OpenCode**  
   Ejemplo: entrar en un entorno que ponga Node en el `PATH` (`nix-shell`, `nix develop`, direnv, etc.).

2. **Tras GC o cambios de perfil, refresca la variable**  
   ```bash
   export OPENCODE_ROUTER_EMBED_NODE="$(command -v node)"
   ```
   Comprueba con `test -x "$OPENCODE_ROUTER_EMBED_NODE" && echo ok`.

3. **Modo autocontenido del fork**  
   `./scripts/opencode-isolated.sh` intenta exportar `OPENCODE_ROUTER_EMBED_NODE` desde `command -v node` si el binario es ejecutable.  
   Si tu `node` solo existe dentro de un **devShell**, lanza OpenCode **desde esa misma shell** (o exporta la variable antes).

4. **Home Manager**  
   El candidato por defecto es  
   `$XDG_STATE_HOME/nix/profiles/home-manager/home-path/bin/node`  
   (con `$XDG_STATE_HOME` = `$HOME/.local/state` si la variable no existe). Si el perfil cambia o tras GC, vuelve a ejecutar el paso 2 o `home-manager switch`.

5. **No uses una ruta en `/nix/store` copiada a mano**  
   Las rutas de store son **inmutables pero recolectables**. Mejor **`$(command -v node)`** o un perfil estable bajo `$HOME`.

## Nota para IDEs / apps GUI (Cursor, etc.)

El entorno de una app GUI puede arrancar con `HOME` o `XDG_STATE_HOME` distintos a tu shell interactiva. Si `HOME` sale mal (por ejemplo `/saturno` en vez de `/Users/saturno`), la expansión de rutas (`${XDG_STATE_HOME}` / `${HOME}`) puede apuntar a un `node` inexistente y producir `posix_spawn ENOENT`.

Comprueba siempre en el **mismo entorno** que lanza OpenCode:

```bash
echo "$HOME"
echo "$XDG_STATE_HOME"
command -v node
test -x "$(command -v node)" && node --version
```

## Comprobación rápida

```bash
command -v node
test -x "$(command -v node)" && echo "node OK"
```

Si el embed sigue fallando, revisa logs con `router_embed_node_missing` / `router_embed_ipc_spawn` (servicio `router-embed`).
