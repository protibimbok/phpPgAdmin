/**
 * Put text on the clipboard. navigator.clipboard exists only on a secure page (https or
 * localhost); over plain http the text goes through a hidden textarea and the copy command, as
 * phpMyAdmin's copy links do. Resolves to whether the browser took it.
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)

      return true
    } catch {
      // Refused (no permission, the page not focused): the fallback below may still work.
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}
