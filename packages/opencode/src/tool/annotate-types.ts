export type Mode = "picker" | "etch"

export interface Box {
  top: number
  left: number
  width: number
  height: number
  padding: Edge
  border: Edge
  margin: Edge
}

export interface Edge {
  top: number
  right: number
  bottom: number
  left: number
}

export interface A11y {
  role: string
  name: string
  live: string
}

export interface Elem {
  selector: string
  xpath: string
  tag: string
  text: string
  attributes: Record<string, string>
  box: Box
  accessibility: A11y
  styles: Record<string, string>
}

export interface Mark {
  element: Elem
  notes: string[]
  screenshot?: string
}

// Persisted pick: stored in Node context so it survives page navigation
export interface StoredPick {
  id: number
  selector: string
  note: string
  ts: number
  url: string
  element?: Elem
}

export interface AnnotationResult {
  type: "annotation"
  url: string
  title: string
  timestamp: number
  mode: "picker"
  screenshot: string
  elements: Mark[]
}

export interface EtchState {
  screenshot: string
  styles: Record<string, Record<string, string>>
}

export interface Change {
  selector: string
  property: string
  before: string
  after: string
}

export interface EtchResult {
  type: "etch"
  url: string
  title: string
  timestamp: number
  mode: "etch"
  before: EtchState
  after: EtchState
  changes: Change[]
  mutations: {
    type: string
    selector: string
    attribute: string
  }[]
}
