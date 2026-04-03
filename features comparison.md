Análisis Comparativo: Upstream vs Fork
Features del Upstream NO implementadas en Lightcode
🔥 ALTA PRIORIDAD (Alto beneficio, complejidad media-baja)
Feature	Descripción
Verification Agent	Agente adversarial que produce veredictos PASS/FAIL/PARTIAL
UltraReview	Code review mejorado
Tool Hooks	Pre/post execution hooks para tools
Tool Search	Buscar y usar tools por keywords
LSP Tool	Integración con Language Server Protocol
WebSocket MCP Transport	Soporte para MCP via WebSocket
🚀 FEATURES PRINCIPALES (Alto beneficio, alta complejidad)
Feature	Descripción
Agent Teams	Equipos de agentes con memoria compartida y coordinación
Agent Swarms	Coordinación de múltiples agentes a gran escala
Remote Agents (CCR)	Agentes en entornos remotos via WebSocket
Session Teleport	Cambiar entre sesiones locales/remotas
Deep Linking	claude:// URL scheme para abrir sesiones
OAuth Flow para MCP	OAuth 2.0 para servers MCP
MCP Server Discovery	Registry de servers MCP oficiales
Voice Mode	Speech-to-text con WebSocket streaming
Chrome MCP Extension	Automatización de browser via native messaging
⚡ MEJORAS INCREMENTALES (Beneficio medio, baja complejidad)
Feature	Descripción
Prompt Input Hooks	HTTP y prompt-based hooks
Stop Hooks	Pre-stop command execution
Session Start Hooks	Hook processing automático
Command Queue	Queue de slash commands
Notification System	Notificaciones in-app
Scheduler (Cron)	Tareas programadas
🔒 SECURITY/ENTERPRISE (No disponibles en fork)
Feature	Descripción
Parser Differential Detection	Detección de diferencias bash/zsh parsing
OS-Level Sandboxing	bubblewrap, filesystem allowlists
Enterprise Policies	Managed settings, MDM, rate limits
Secret Scanning	Escanear secrets en team memory
API Key Verification	Custom API key approval flow
📊 ANALYTICS/TELEMETRY
Feature	Descripción
GrowthBook	Feature flags y A/B testing
DataDog	Performance monitoring
First-Party Logging	Custom event logging
FPS Tracking	Métricas de renderizado UI