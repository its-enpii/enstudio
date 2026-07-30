/* Raw SVG strings for Icon.svelte — recolored to currentColor at render. */

import ai_agent from './ai-agent.svg?raw'
import alert from './alert.svg?raw'
import arrow_down from './arrow-down.svg?raw'
import arrow_left from './arrow-left.svg?raw'
import arrow_right from './arrow-right.svg?raw'
import arrow_up from './arrow-up.svg?raw'
import bell from './bell.svg?raw'
import browser from './browser.svg?raw'
import chat_gpt from './chat-gpt.svg?raw'
import check from './check.svg?raw'
import chevron_down from './chevron-down.svg?raw'
import chevron_left from './chevron-left.svg?raw'
import chevron_right from './chevron-right.svg?raw'
import chevron_up from './chevron-up.svg?raw'
import circle_minus from './circle-minus.svg?raw'
import circle_plus from './circle-plus.svg?raw'
import circle_x from './circle-x.svg?raw'
import claude from './claude.svg?raw'
import close from './close.svg?raw'
import code from './code.svg?raw'
import copy from './copy.svg?raw'
import cpu from './cpu.svg?raw'
import diff from './diff.svg?raw'
import download from './download.svg?raw'
import external_link from './external-link.svg?raw'
import eye from './eye.svg?raw'
import eye_off from './eye-off.svg?raw'
import file from './file.svg?raw'
import find from './find.svg?raw'
import folder from './folder.svg?raw'
import folder_plus from './folder-plus.svg?raw'
import gemini from './gemini.svg?raw'
import git from './git.svg?raw'
import git_branch from './git-branch.svg?raw'
import git_commit from './git-commit.svg?raw'
import history from './history.svg?raw'
import info from './info.svg?raw'
import json from './json.svg?raw'
import key from './key.svg?raw'
import link from './link.svg?raw'
import logo from './logo.svg?raw'
import markdown from './markdown.svg?raw'
import moon from './moon.svg?raw'
import more_vertical from './more-vertical.svg?raw'
import opencode from './opencode.svg?raw'
import paperclip from './paperclip.svg?raw'
import pencil from './pencil.svg?raw'
import pencil_circle from './pencil-circle.svg?raw'
import plus from './plus.svg?raw'
import refresh from './refresh.svg?raw'
import reload from './reload.svg?raw'
import save from './save.svg?raw'
import search from './search.svg?raw'
import send from './send.svg?raw'
import server from './server.svg?raw'
import setting from './setting.svg?raw'
import sparkles from './sparkles.svg?raw'
import star_fill from './star-fill.svg?raw'
import star_outline from './star-outline.svg?raw'
import stop from './stop.svg?raw'
import sun from './sun.svg?raw'
import terminal from './terminal.svg?raw'
import trash from './trash.svg?raw'

export const icons = {
  'ai-agent': ai_agent,
  'alert': alert,
  'arrow-down': arrow_down,
  'arrow-left': arrow_left,
  'arrow-right': arrow_right,
  'arrow-up': arrow_up,
  'bell': bell,
  'browser': browser,
  'chat-gpt': chat_gpt,
  'check': check,
  'chevron-down': chevron_down,
  'chevron-left': chevron_left,
  'chevron-right': chevron_right,
  'chevron-up': chevron_up,
  'circle-minus': circle_minus,
  'circle-plus': circle_plus,
  'circle-x': circle_x,
  'claude': claude,
  'close': close,
  'code': code,
  'copy': copy,
  'cpu': cpu,
  'diff': diff,
  'download': download,
  'external-link': external_link,
  'eye': eye,
  'eye-off': eye_off,
  'file': file,
  'find': find,
  'folder': folder,
  'folder-plus': folder_plus,
  'gemini': gemini,
  'git': git,
  'git-branch': git_branch,
  'git-commit': git_commit,
  'history': history,
  'info': info,
  'json': json,
  'key': key,
  'link': link,
  'logo': logo,
  'markdown': markdown,
  'moon': moon,
  'more-vertical': more_vertical,
  'opencode': opencode,
  'paperclip': paperclip,
  'pencil': pencil,
  'pencil-circle': pencil_circle,
  'plus': plus,
  'refresh': refresh,
  'reload': reload,
  'save': save,
  'search': search,
  'send': send,
  'server': server,
  'setting': setting,
  'sparkles': sparkles,
  'star-fill': star_fill,
  'star-outline': star_outline,
  'stop': stop,
  'sun': sun,
  'terminal': terminal,
  'trash': trash,
  settings: setting,
} as const

export type IconName = keyof typeof icons

