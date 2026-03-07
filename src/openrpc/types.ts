/** Minimal TypeScript types for the OpenRPC 1.2.6 specification. */

export type OpenRpcSchema = {
  [key: string]: any
}

export type OpenRpcParam = {
  name: string
  summary?: string
  description?: string
  required?: boolean
  schema: OpenRpcSchema
}

export type OpenRpcExample = {
  name: string
  params: { name: string; value: any }[]
  result: { name: string; value: any }
}

export type OpenRpcMethod = {
  name: string
  summary?: string
  description?: string
  paramStructure?: 'by-name' | 'by-position' | 'either'
  params: OpenRpcParam[]
  result: {
    name: string
    schema: OpenRpcSchema
  }
  examples?: OpenRpcExample[]
}

export type OpenRpcSpec = {
  openrpc: string
  info: {
    title: string
    description?: string
    version: string
  }
  methods: OpenRpcMethod[]
}
