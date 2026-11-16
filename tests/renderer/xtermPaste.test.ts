import { describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/xterm'

// 拖进终端（memo-floating-window 决策 5）靠的是 xterm 自己的 paste：经 onData 发给 pty、不加回车；
// 程序开了括号粘贴模式（Claude Code 等）时整段包在 ESC[200~ … ESC[201~ 里，算一次粘贴。用真实库守住这个前提
//（假终端只记录 paste 被调过，证明不了库真会这样发），升级 xterm 时它先报警。
/** paste 要往隐藏的 textarea 里写，得先 open（happy-dom 下挂到一个 div 上即可） */
function opened(): Terminal {
  const term = new Terminal({ allowProposedApi: true })
  const host = document.createElement('div')
  document.body.appendChild(host)
  term.open(host)
  return term
}

async function sentByPaste(term: Terminal, text: string): Promise<string> {
  let sent = ''
  const sub = term.onData((d) => {
    sent += d
  })
  term.paste(text)
  sub.dispose()
  return sent
}

const writeAndWait = (term: Terminal, data: string): Promise<void> =>
  new Promise((resolve) => term.write(data, resolve))

describe('xterm paste（真实库）', () => {
  it('普通模式：原样发出，不加回车', async () => {
    const term = opened()
    expect(await sentByPaste(term, '设置「启动」段加勾选框')).toBe('设置「启动」段加勾选框')
    term.dispose()
  })

  it('程序开了括号粘贴（ESC[?2004h）：整段包在 ESC[200~ … ESC[201~ 里，仍不加回车', async () => {
    const term = opened()
    await writeAndWait(term, '\x1b[?2004h')
    expect(await sentByPaste(term, '补 Codex 的进程链用例')).toBe(
      '\x1b[200~补 Codex 的进程链用例\x1b[201~',
    )
    term.dispose()
  })
})
