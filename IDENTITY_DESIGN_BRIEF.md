# LightCode — Design Brief

Este documento es la fuente compacta y autoritativa para implementar la identidad actual de LightCode.

No describe alternativas.  
Describe la dirección **ya elegida**.

---

## 1. Declaración de producto

LightCode es un **persistent coding system**.

No se debe diseñar como:

- otro assistant chat oscuro
- otro dashboard de productividad
- otro fork con branding nuevo
- otro producto sci-fi decorativo

Sí se debe diseñar como:

- un sistema de trabajo para software de larga duración
- una interfaz donde la memoria tiene forma y estructura
- un producto que hace visible la continuidad entre trabajo actual y contexto persistente

---

## 2. Metáfora rectora

### Metáfora elegida
**Memory Atlas**

### Superficie central
**Atlas Field**

### Traducción visual de la metáfora
La memoria infinita no se representa como una lista interminable.  
Se representa como un **campo relacional**:

- centro = thread activo
- órbita cercana = anchors y memoria relacionada
- clusters = zonas semánticas o funcionales
- signals = trabajo pendiente o relación operativa
- drift = tensión o desalineación

### Regla
La metáfora debe afectar la interacción, no solo el look.

---

## 3. Dirección visual oficial

### Base
**Void Black**

### Intención visual
- más espacio real que ciencia ficción estilizada
- más profundidad que brillo
- más silencio que espectáculo
- más estructura que decoración

### Debe sentirse
- preciso
- oscuro
- profundo
- premium
- operativo
- enfocado

### Debe evitar
- fondos morados dominantes
- neon cyberpunk
- recursos espaciales literales
- demasiadas cards
- “dashboard para métricas”
- exceso de barras, pills y widgets repetidos

---

## 4. Color system oficial

### Background
Negro espacial casi absoluto.

### Surface
Negro grisáceo frío.

### Borders
Azul grisáceo oscuro.

### Color roles
- **Thread activo** → cian frío
- **Anchors / memory** → azul frío
- **Signals** → ámbar suave
- **Drift** → rojo apagado

### Restricción
El morado puede existir como atmósfera de soporte, pero **no** debe dominar la interfaz.

### Regla
El color debe ordenar la semántica del campo, no volverlo decorativo.

---

## 5. Composición oficial del TUI principal

### Izquierda — Atlas Index
Rol:
- filtros
- leyenda
- lectura rápida del campo
- acceso a paths

No debe convertirse en un segundo dashboard.

### Centro — Atlas Field
Rol:
- superficie principal
- grafo vivo
- thread activo en el centro
- nodos cercanos por relevancia
- clusters legibles
- topología útil

Esta es la pieza principal del producto.

### Derecha — Context Panel
Rol:
- detalle del nodo seleccionado
- relaciones más cercanas
- interpretación del campo
- acciones

Debe ser secundaria frente al centro, no competir con él.

---

## 6. Gramática visual del grafo

### Debe tener
- nodo central claro
- gradiente de relevancia hacia la periferia
- clusters legibles
- edge density entendible
- etiquetas legibles cerca del foco
- periferia más tenue
- halos muy controlados

### No debe tener
- ruido de cientos de nodos sin jerarquía
- conexiones aleatorias
- etiquetas compitiendo por atención
- exceso de glow
- apariencia de wallpaper de constelaciones

### Inspiración útil
La lógica del graph de Obsidian:
- proximidad
- relación
- cluster
- foco

### Diferencia esencial
LightCode no muestra notas.  
Muestra:
- threads
- anchors
- signals
- drift
- memory fragments

---

## 7. Vocabulario visible

### Términos oficiales
- **Memory Atlas**
- **Atlas Field**
- **Thread**
- **Anchor**
- **Signal**
- **Drift**
- **Telemetry**

### Términos a relegar
- session
- status
- generic memory
- ask anything

### Reglas
- el lenguaje visible debe moverse hacia el vocabulario del atlas
- los términos técnicos internos pueden mantenerse temporalmente si renombrarlos rompe compatibilidad
- el lenguaje del usuario y el lenguaje interno no tienen por qué cambiar al mismo ritmo

---

## 8. Voz del producto

### Tono
- claro
- sobrio
- técnico
- seguro
- no promocional
- no hype

### Debe sonar como
una herramienta de trabajo seria.

### No debe sonar como
un chatbot genérico o una demo de IA.

---

## 9. Componentes distintivos

Los elementos visuales que deben volverse firma de LightCode son:

1. **Atlas Field**
2. **Context Panel**
3. **Atlas Index**
4. **Prompt surface**

Estos cuatro elementos deben sentirse parte del mismo sistema.

---

## 10. Decisiones cerradas

Estas decisiones ya no están abiertas:

- categoría: **persistent coding system**
- metáfora: **Memory Atlas**
- superficie principal: **Atlas Field**
- paleta base: **Void Black**
- lógica del campo: **graph-driven**
- inspiración de interacción: **Obsidian graph logic adaptada**
- color del thread activo: **cian frío**
- color de anchors/memory: **azul frío**
- color de signals: **ámbar**
- color de drift: **rojo apagado**

---

## 11. Qué no debe hacer un implementador

- no inventar nuevas metáforas
- no volver a una UI de cards genéricas
- no usar morado como color dominante
- no introducir sci-fi literal
- no usar glow fuerte como recurso principal
- no cambiar la composición aprobada sin una razón clara
- no degradar el grafo a simple adorno

---

## 12. Qué sí debe hacer un implementador

- reforzar el Atlas Field
- mejorar la legibilidad del grafo
- refinar jerarquía y contraste
- preservar la composición validada
- hacer la interfaz más usable sin quitarle identidad
- traducir memoria infinita a navegación útil

---

## 13. Definición de éxito

La implementación es correcta si:

- el centro se percibe claramente como el corazón del producto
- la metáfora de atlas se entiende sin explicarla demasiado
- el producto se ve propio
- el color ayuda a leer relaciones
- la interfaz no se siente como OpenCode con otro tema

La implementación es incorrecta si:

- la metáfora queda solo decorativa
- el grafo parece un fondo bonito sin utilidad
- la derecha y la izquierda vuelven a parecer dashboards genéricos
- el color compite con la legibilidad
