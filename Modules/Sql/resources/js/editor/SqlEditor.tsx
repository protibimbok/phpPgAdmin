import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { PostgreSQL, sql, type SQLNamespace } from '@codemirror/lang-sql'
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorSelection, EditorState, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder, type DecorationSet } from '@codemirror/view'

/** Marks the text an error points at, as pgAdmin's setErrorMark; null clears it. */
const setErrorMark = StateEffect.define<{ from: number; to: number } | null>()
const errorMarkDecoration = Decoration.mark({ class: 'cm-error-mark' })

/** The error mark, dropped as soon as the text changes. */
const errorMark = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    let next = tr.docChanged ? Decoration.none : marks
    for (const effect of tr.effects) {
      if (!effect.is(setErrorMark)) continue
      next = effect.value === null || effect.value.from >= effect.value.to ? Decoration.none : Decoration.set([errorMarkDecoration.range(effect.value.from, effect.value.to)])
    }

    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

export interface SqlEditorHandle {
  /** Insert text at the cursor, replacing the selection, and keep focus. */
  insert: (text: string) => void
  focus: () => void
  /** The selected text and where it starts; null when nothing but whitespace is selected. */
  selection: () => { text: string; from: number } | null
  /** Where the cursor is. */
  cursor: () => number
  /** Underline the text from..to as the place an error points at, and put the cursor there. */
  markError: (from: number, to: number) => void
  clearError: () => void
}

export interface SqlEditorProps {
  value: string
  onChange: (value: string) => void
  /** Ctrl+Enter (or Cmd+Enter) runs it, as phpMyAdmin's editor does. */
  onSubmit?: () => void
  /** Alt+F5 runs the statement at the cursor (pgAdmin's "Execute query"). */
  onRunStatement?: () => void
  id?: string
  ariaLabel?: string
  autoFocus?: boolean
  placeholder?: string
  className?: string
  /** The tables and columns completions may offer, "schema.table" => columns; the default schema's tables also by bare name. */
  schema?: SQLNamespace
  defaultSchema?: string
  /** Line numbers in a gutter, on by default; the console's box has none. */
  lineNumbers?: boolean
  /** Enter runs the query and Shift+Enter inserts a line (the console's option); off, Enter inserts a line. */
  enterSubmits?: boolean
}

/**
 * The SQL box: CodeMirror 6 with the PostgreSQL dialect, line numbers, bracket matching and
 * completions of keywords and, given a schema, of tables and columns, standing in for the
 * textarea phpMyAdmin turns into a CodeMirror 5 editor. The text is controlled by the parent;
 * a change of the value from outside is written into the editor.
 */
const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(function SqlEditor(
  { value, onChange, onSubmit, onRunStatement, id, ariaLabel, autoFocus, placeholder: hint, className, schema, defaultSchema, lineNumbers: gutter = true, enterSubmits = false },
  ref,
) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSubmitRef = useRef(onSubmit)
  const onRunStatementRef = useRef(onRunStatement)
  const enterSubmitsRef = useRef(enterSubmits)
  const lastValue = useRef(value)
  const language = useRef(new Compartment())
  const languageFor = (names?: SQLNamespace, def?: string) => sql({ dialect: PostgreSQL, upperCaseKeywords: true, schema: names, defaultSchema: def })

  onChangeRef.current = onChange
  onSubmitRef.current = onSubmit
  onRunStatementRef.current = onRunStatement
  enterSubmitsRef.current = enterSubmits

  useEffect(() => {
    if (!host.current) return

    const state = EditorState.create({
      doc: lastValue.current,
      extensions: [
        gutter ? [lineNumbers(), highlightActiveLineGutter()] : [],
        closeBrackets(),
        autocompletion(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        errorMark,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        language.current.of(languageFor(schema, defaultSchema)),
        EditorView.lineWrapping,
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              onSubmitRef.current?.()

              return true
            },
          },
          {
            // pgAdmin's "Execute script" (F5) and "Execute query" (Alt+F5).
            key: 'F5',
            run: () => {
              onSubmitRef.current?.()

              return true
            },
          },
          {
            key: 'Alt-F5',
            run: () => {
              if (!onRunStatementRef.current) return false
              onRunStatementRef.current()

              return true
            },
          },
          {
            key: 'Enter',
            run: () => {
              if (!enterSubmitsRef.current) return false
              onSubmitRef.current?.()

              return true
            },
            shift: () => false,
          },
          indentWithTab,
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const text = update.state.doc.toString()
            lastValue.current = text
            onChangeRef.current(text)
          }
        }),
        hint ? placeholder(hint) : [],
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? 'SQL query', ...(id ? { id } : {}) }),
      ],
    })

    const editor = new EditorView({ state, parent: host.current })
    view.current = editor
    if (autoFocus) editor.focus()

    return () => {
      editor.destroy()
      view.current = null
    }
    // The editor is created once; the props it reads later go through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The completions follow the catalog once it is loaded.
  useEffect(() => {
    view.current?.dispatch({ effects: language.current.reconfigure(languageFor(schema, defaultSchema)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, defaultSchema])

  // A value set from outside (a quick button, "Get auto-saved query") replaces the document.
  useEffect(() => {
    const editor = view.current
    if (!editor || value === lastValue.current) return
    lastValue.current = value
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
  }, [value])

  useImperativeHandle(ref, () => ({
    insert(text) {
      const editor = view.current
      if (!editor) return
      editor.dispatch(editor.state.replaceSelection(text))
      editor.focus()
    },
    focus() {
      view.current?.focus()
    },
    selection() {
      const editor = view.current
      if (!editor) return null
      const range = editor.state.selection.main
      const text = editor.state.sliceDoc(range.from, range.to)

      return text.trim() === '' ? null : { text, from: range.from }
    },
    cursor() {
      return view.current?.state.selection.main.head ?? 0
    },
    markError(from, to) {
      const editor = view.current
      if (!editor) return
      const length = editor.state.doc.length
      const start = Math.max(0, Math.min(from, length))
      const end = Math.max(start, Math.min(to, length))
      editor.dispatch({ effects: [setErrorMark.of({ from: start, to: end }), EditorView.scrollIntoView(start, { y: 'center' })], selection: EditorSelection.cursor(end) })
      editor.focus()
    },
    clearError() {
      view.current?.dispatch({ effects: setErrorMark.of(null) })
    },
  }))

  return <div ref={host} className={`sql-editor${className ? ` ${className}` : ''}`} />
})

export default SqlEditor
