/**
 * Scene graph API — the main interface for building and manipulating
 * the TGE scene tree.
 */

import { create, type NodeKind, type SceneNode, type LayoutConstraints, type StyleProperties } from "./node"
import { mark, deep } from "./dirty"

export type NodeProps = {
  tag?: string
  layout?: Partial<LayoutConstraints>
  style?: Partial<StyleProperties>
  data?: Record<string, unknown>
}

/** Create a new scene graph with a root node. */
export function scene(width = 0, height = 0) {
  const root = create("root", "root")
  root.computed.width = width
  root.computed.height = height
  return {
    root,

    /** Create a new node and optionally attach it to a parent. */
    add(kind: NodeKind, props?: NodeProps, parent?: SceneNode): SceneNode {
      const node = create(kind, props?.tag)
      if (props?.layout) Object.assign(node.layout, props.layout)
      if (props?.style) Object.assign(node.style, props.style)
      if (props?.data) Object.assign(node.data, props.data)
      append(parent ?? root, node)
      return node
    },

    /** Update a node's properties and mark dirty. */
    update(node: SceneNode, props: Partial<NodeProps>) {
      if (props.layout) Object.assign(node.layout, props.layout)
      if (props.style) Object.assign(node.style, props.style)
      if (props.data) Object.assign(node.data, props.data)
      mark(node)
    },

    /** Remove a node from the tree. */
    remove(node: SceneNode) {
      detach(node)
    },

    /** Move a node to a new parent. */
    move(node: SceneNode, parent: SceneNode) {
      detach(node)
      append(parent, node)
    },

    /** Mark a subtree as needing full re-layout and re-paint. */
    invalidate(node: SceneNode) {
      deep(node)
    },

    /** Resize the viewport. */
    resize(w: number, h: number) {
      root.computed.width = w
      root.computed.height = h
      deep(root)
    },
  }
}

export type Scene = ReturnType<typeof scene>

// ─── Internal tree ops ────────────────────────────────────────────────

function append(parent: SceneNode, child: SceneNode) {
  if (child.parent) detach(child)
  child.parent = parent
  parent.children.push(child)
  mark(child)
}

function detach(node: SceneNode) {
  if (!node.parent) return
  const siblings = node.parent.children
  const idx = siblings.indexOf(node)
  if (idx >= 0) siblings.splice(idx, 1)
  mark(node.parent)
  node.parent = null
}

// Re-export types
export type { SceneNode, NodeKind, LayoutConstraints, StyleProperties, Rect, Edges, Corners } from "./node"
export type { BorderStyle, ShadowStyle, HaloStyle, FlexDir, Align, Justify, Overflow, Position, Size } from "./node"
export { defaults, reset } from "./node"
export { mark, deep, clean, cleanAll, rects } from "./dirty"
export { walk, post, find, tagged, collect, count, ancestors } from "./traverse"
