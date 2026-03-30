# Source after zsh-autosuggestions (and zsh-vi-mode if used).
# Gray ghost text is not in BUFFER until accepted; default Enter runs only the typed prefix.
bindkey '^M' autosuggest-execute
bindkey -M viins '^M' autosuggest-execute
