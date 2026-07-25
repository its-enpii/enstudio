import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface ProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
  dialect: 'openai' | 'anthropic'
}

const DEFAULTS: ProviderConfig = {
  baseUrl: 'https://ai.enpiistudio.com/v1',
  apiKey: '',
  model: 'enpii',
  dialect: 'openai',
}

function configPath(): string {
  return path.join(os.homedir(), '.enpiistudio', 'config.json')
}

function readFileConfig(): Partial<ProviderConfig> {
  try {
    // PowerShell Set-Content -Encoding utf8 writes a BOM
    const raw = fs.readFileSync(configPath(), 'utf8').replace(/^﻿/, '')
    const data = JSON.parse(raw) as Record<string, unknown>
    return {
      baseUrl:
        typeof data.baseUrl === 'string'
          ? data.baseUrl
          : typeof data.base_url === 'string'
            ? data.base_url
            : undefined,
      apiKey:
        typeof data.apiKey === 'string'
          ? data.apiKey
          : typeof data.api_key === 'string'
            ? data.api_key
            : undefined,
      model: typeof data.model === 'string' ? data.model : undefined,
      dialect:
        data.dialect === 'anthropic' || data.dialect === 'openai'
          ? data.dialect
          : data.api_dialect === 'anthropic' || data.api_dialect === 'openai'
            ? data.api_dialect
            : undefined,
    }
  } catch {
    return {}
  }
}

/** Priority: env → ~/.enpiistudio/config.json → defaults */
export function loadProviderConfig(): ProviderConfig {
  const file = readFileConfig()
  return {
    baseUrl: (
      process.env.ENPII_BASE_URL ||
      file.baseUrl ||
      DEFAULTS.baseUrl
    ).replace(/\/+$/, ''),
    apiKey: process.env.ENPII_API_KEY || file.apiKey || DEFAULTS.apiKey,
    model: process.env.ENPII_MODEL || file.model || DEFAULTS.model,
    dialect:
      process.env.ENPII_DIALECT === 'anthropic' || process.env.ENPII_DIALECT === 'openai'
        ? process.env.ENPII_DIALECT
        : file.dialect || DEFAULTS.dialect,
  }
}

export function assertProviderReady(cfg: ProviderConfig): void {
  if (!cfg.apiKey?.trim()) {
    throw new Error(
      'No API key. Set ENPII_API_KEY or write apiKey to ~/.enpiistudio/config.json',
    )
  }
  if (!cfg.baseUrl?.trim()) {
    throw new Error('No baseUrl for provider')
  }
}
