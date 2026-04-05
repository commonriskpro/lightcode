export const Share = {
  info(id: string) {
    return `share/session/info/${id}.json`
  },
  message(id: string) {
    return `share/session/message/${id}/`
  },
  part(id: string) {
    return `share/session/part/${id}/`
  },
  object(key: string) {
    return `share/${key}.json`
  },
  clear(id: string) {
    return {
      drop: [Share.message(id), Share.part(id)],
      del: Share.info(id),
    }
  },
}
