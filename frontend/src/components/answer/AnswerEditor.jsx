import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Color from '@tiptap/extension-color';
import TextStyle from '@tiptap/extension-text-style';
import Link from '@tiptap/extension-link';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, Quote, Heading1, Heading2, Heading3,
  Undo2, Redo2, AlignRight, AlignCenter, AlignLeft, AlignJustify,
  Highlighter, Link as LinkIcon, Minus, ChevronDown, ChevronUp,
  FileText, Subscript as SubscriptIcon, Superscript as SuperscriptIcon,
  Type, Palette,
} from 'lucide-react';
import { clsx } from 'clsx';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Spinner from '../ui/Spinner';
import PublishConfirmModal from './PublishConfirmModal';
import api from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDraftTime(iso) {
  try {
    return new Date(iso).toLocaleString('he-IL', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function draftKey(qid) { return `answer_draft_${qid}`; }

const FONT_SIZES = ['14', '16', '18', '20', '24', '28', '32'];
const TEXT_COLORS = [
  { label: 'שחור',   value: '#000000' },
  { label: 'כחול כהה', value: '#1e3a5f' },
  { label: 'כחול',   value: '#2563eb' },
  { label: 'ירוק',   value: '#16a34a' },
  { label: 'אדום',   value: '#dc2626' },
  { label: 'סגול',   value: '#7c3aed' },
  { label: 'חום',    value: '#92400e' },
  { label: 'אפור',   value: '#6b7280' },
];
const HIGHLIGHT_COLORS = [
  { label: 'צהוב',   value: '#fef08a' },
  { label: 'ירוק',   value: '#bbf7d0' },
  { label: 'כחול',   value: '#bfdbfe' },
  { label: 'ורוד',   value: '#fbcfe8' },
  { label: 'כתום',   value: '#fed7aa' },
];

// ── Toolbar atoms ────────────────────────────────────────────────────────────

function TB({ onClick, active, disabled, title, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick?.(); }}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={!!active}
      className={clsx(
        'inline-flex items-center justify-center w-7 h-7 rounded text-[var(--text-secondary)]',
        'hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] transition-colors',
        'disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none',
        active && 'bg-brand-navy/10 text-brand-navy',
      )}
    >{children}</button>
  );
}

function TBDiv() {
  return <span className="w-px h-5 bg-[var(--border-default)] mx-1 flex-shrink-0" />;
}

function ColorPicker({ label, colors, onSelect, icon }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setOpen((v) => !v); }}
        title={label}
        className="inline-flex items-center justify-center w-7 h-7 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] transition-colors"
      >
        {icon}
      </button>
      {open && (
        <div className="absolute top-8 right-0 z-50 flex flex-wrap gap-1 p-2 bg-white border border-gray-200 rounded-lg shadow-lg w-32">
          {colors.map((c) => (
            <button
              key={c.value}
              type="button"
              title={c.label}
              onMouseDown={(e) => { e.preventDefault(); onSelect(c.value); setOpen(false); }}
              className="w-7 h-7 rounded border border-gray-300 hover:scale-110 transition-transform"
              style={{ backgroundColor: c.value }}
            />
          ))}
          <button
            type="button"
            title="הסר צבע"
            onMouseDown={(e) => { e.preventDefault(); onSelect(null); setOpen(false); }}
            className="w-7 h-7 rounded border border-gray-300 bg-white text-xs text-gray-500 hover:bg-gray-100 flex items-center justify-center"
          >✕</button>
        </div>
      )}
    </div>
  );
}

function FontSizePicker({ editor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = editor?.getAttributes('textStyle')?.fontSize?.replace('px', '') || '16';

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setOpen((v) => !v); }}
        title="גודל גופן"
        className="inline-flex items-center gap-1 h-7 px-2 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] text-xs font-medium transition-colors border border-[var(--border-default)]"
      >
        <Type size={12} />
        <span className="tabular-nums">{current}</span>
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute top-8 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[60px]">
          {FONT_SIZES.map((sz) => (
            <button
              key={sz}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                editor.chain().focus().setMark('textStyle', { fontSize: `${sz}px` }).run();
                setOpen(false);
              }}
              className={clsx(
                'w-full text-right px-3 py-1 text-sm hover:bg-gray-100 transition-colors font-heebo',
                sz === current && 'font-bold text-brand-navy'
              )}
            >{sz}px</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function AnswerEditor({ questionId, existingAnswer, onSave, onOpenTemplates }) {
  const { rabbi } = useAuth();
  const [draftNotice, setDraftNotice] = useState(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const autoSaveRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'], defaultAlignment: 'right' }),
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener', target: '_blank' } }),
      Subscript,
      Superscript,
      Placeholder.configure({ placeholder: 'כתוב את תשובתך כאן...', emptyEditorClass: 'is-editor-empty' }),
      CharacterCount,
    ],
    content: existingAnswer || '',
    editorProps: {
      attributes: {
        dir: 'rtl', lang: 'he',
        class: 'answer-editor-content min-h-[300px] max-h-[600px] overflow-y-auto px-5 py-4 text-[var(--text-primary)] font-heebo text-base leading-relaxed focus:outline-none prose prose-answer',
      },
    },
    onUpdate: ({ editor: ed }) => scheduleAutoSave(ed.getHTML()),
  });

  // Load draft from localStorage
  useEffect(() => {
    if (!questionId) return;
    try {
      const raw = localStorage.getItem(draftKey(questionId));
      if (raw) {
        const p = JSON.parse(raw);
        if (p.html && p.html !== (existingAnswer || '')) setDraftNotice(p);
      }
    } catch { /* ignore */ }
  }, [questionId]); // eslint-disable-line

  const scheduleAutoSave = useCallback((html) => {
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => {
      if (!questionId) return;
      try { localStorage.setItem(draftKey(questionId), JSON.stringify({ html, savedAt: new Date().toISOString() })); }
      catch { /* ignore */ }
    }, 15_000);
  }, [questionId]);

  useEffect(() => () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current); }, []);

  const handleRestoreDraft = useCallback(() => {
    if (!editor || !draftNotice) return;
    editor.commands.setContent(draftNotice.html, true);
    setDraftRestored(true); setDraftNotice(null);
  }, [editor, draftNotice]);

  const handleDiscardDraft = useCallback(() => {
    if (questionId) { try { localStorage.removeItem(draftKey(questionId)); } catch { /* ignore */ } }
    setDraftNotice(null);
  }, [questionId]);

  const handleSaveDraft = useCallback(async () => {
    if (!editor || !questionId) return;
    const html = editor.getHTML();
    setSavingDraft(true); setSaveError(null);
    try {
      await api.post(`/questions/answer/${questionId}`, { content: html, publishNow: false });
      try { localStorage.setItem(draftKey(questionId), JSON.stringify({ html, savedAt: new Date().toISOString() })); } catch { /* ignore */ }
      onSave?.({ html, publishNow: false });
    } catch (err) {
      setSaveError(err?.response?.data?.message || 'שגיאה בשמירת הטיוטה.');
    } finally { setSavingDraft(false); }
  }, [editor, questionId, onSave]);

  const handlePublishConfirm = useCallback(async ({ html }) => {
    await api.post(`/questions/answer/${questionId}`, { content: html, publishNow: true });
    try { localStorage.removeItem(draftKey(questionId)); } catch { /* ignore */ }
    onSave?.({ html, publishNow: true });
  }, [questionId, onSave]);

  const handleSetLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes('link').href || '';
    setLinkUrl(prev); setLinkDialogOpen(true);
  }, [editor]);

  const handleConfirmLink = useCallback(() => {
    if (!editor) return;
    if (linkUrl.trim()) {
      editor.chain().focus().setLink({ href: linkUrl.trim() }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    setLinkDialogOpen(false); setLinkUrl('');
  }, [editor, linkUrl]);

  const charCount = editor?.storage?.characterCount?.characters?.() ?? 0;
  const wordCount = editor?.storage?.characterCount?.words?.() ?? 0;
  const signature = rabbi?.signature || '';

  if (!editor) return <div className="flex items-center justify-center py-16"><Spinner size="md" /></div>;

  return (
    <div className="flex flex-col gap-3" dir="rtl">

      {/* Draft restore notice */}
      {draftNotice && (
        <div className="flex items-center gap-3 flex-wrap px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm font-heebo">
          <span className="flex-1">נמצאה טיוטה מ-{formatDraftTime(draftNotice.savedAt)} — לשחזר?</span>
          <button type="button" onClick={handleRestoreDraft} className="font-semibold underline hover:no-underline">שחזר</button>
          <button type="button" onClick={handleDiscardDraft} className="text-amber-600 hover:underline">התעלם</button>
        </div>
      )}
      {draftRestored && <p className="text-sm text-emerald-600 font-heebo px-1">הטיוטה שוחזרה בהצלחה.</p>}

      {/* Editor Card */}
      <div className="rounded-xl border border-[var(--border-default)] overflow-hidden shadow-sm">

        {/* ── TOOLBAR ROW 1: format + alignment ── */}
        <div className="flex items-center gap-0.5 flex-wrap px-2 py-1.5 border-b border-[var(--border-default)] bg-[var(--bg-surface-raised)]">

          {/* Font size */}
          <FontSizePicker editor={editor} />
          <TBDiv />

          {/* Text format */}
          <TB title="מודגש (Ctrl+B)" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={14} strokeWidth={2.5} /></TB>
          <TB title="נטוי (Ctrl+I)" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={14} strokeWidth={2.5} /></TB>
          <TB title="קו תחתי (Ctrl+U)" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon size={14} strokeWidth={2.5} /></TB>
          <TB title="קו חוצה" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={14} strokeWidth={2.5} /></TB>
          <TB title="כתב עילי" active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()}><SuperscriptIcon size={13} strokeWidth={2} /></TB>
          <TB title="כתב שפלי" active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()}><SubscriptIcon size={13} strokeWidth={2} /></TB>

          <TBDiv />

          {/* Color pickers */}
          <ColorPicker
            label="צבע טקסט"
            colors={TEXT_COLORS}
            icon={<Palette size={14} strokeWidth={2} />}
            onSelect={(c) => c ? editor.chain().focus().setColor(c).run() : editor.chain().focus().unsetColor().run()}
          />
          <ColorPicker
            label="סימון טקסט"
            colors={HIGHLIGHT_COLORS}
            icon={<Highlighter size={14} strokeWidth={2} />}
            onSelect={(c) => c ? editor.chain().focus().setHighlight({ color: c }).run() : editor.chain().focus().unsetHighlight().run()}
          />

          <TBDiv />

          {/* Alignment */}
          <TB title="יישור לימין" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight size={14} strokeWidth={2} /></TB>
          <TB title="מרכז" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter size={14} strokeWidth={2} /></TB>
          <TB title="יישור לשמאל" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft size={14} strokeWidth={2} /></TB>
          <TB title="פיזור שווה" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()}><AlignJustify size={14} strokeWidth={2} /></TB>

          <TBDiv />

          {/* Undo/Redo */}
          <TB title="בטל (Ctrl+Z)" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={14} strokeWidth={2} /></TB>
          <TB title="בצע שוב (Ctrl+Y)" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={14} strokeWidth={2} /></TB>

          <div className="flex-1" />
          {onOpenTemplates && (
            <button type="button" onClick={onOpenTemplates} className="inline-flex items-center gap-1.5 px-2 h-7 rounded text-xs font-heebo text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--bg-muted)] transition-colors">
              <FileText size={12} /> תבניות
            </button>
          )}
        </div>

        {/* ── TOOLBAR ROW 2: structure ── */}
        <div className="flex items-center gap-0.5 flex-wrap px-2 py-1.5 border-b border-[var(--border-default)] bg-[var(--bg-surface)]">
          {/* Headings */}
          <TB title="כותרת ראשית" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={15} strokeWidth={2} /></TB>
          <TB title="כותרת משנית" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={15} strokeWidth={2} /></TB>
          <TB title="כותרת שלישית" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={15} strokeWidth={2} /></TB>

          <TBDiv />

          {/* Lists */}
          <TB title="רשימה לא ממוספרת" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15} strokeWidth={2} /></TB>
          <TB title="רשימה ממוספרת" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} strokeWidth={2} /></TB>

          <TBDiv />

          {/* Block elements */}
          <TB title="ציטוט" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={14} strokeWidth={2} /></TB>
          <TB title="קו מפריד" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={14} strokeWidth={2.5} /></TB>
          <TB title="קישור" active={editor.isActive('link')} onClick={handleSetLink}><LinkIcon size={14} strokeWidth={2} /></TB>
        </div>

        {/* Editor area */}
        <EditorContent editor={editor} />

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-[var(--border-default)] bg-[var(--bg-surface-raised)]">
          <span className="text-xs text-[var(--text-muted)] font-heebo">
            {wordCount.toLocaleString('he-IL')} מילים
          </span>
          <span className="text-xs text-[var(--text-muted)] font-heebo tabular-nums">
            {charCount.toLocaleString('he-IL')} תווים
          </span>
        </div>
      </div>

      {/* Link dialog */}
      {linkDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm" dir="rtl">
            <h3 className="font-semibold text-[var(--text-primary)] font-heebo mb-3">הוסף קישור</h3>
            <input
              autoFocus
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmLink(); if (e.key === 'Escape') setLinkDialogOpen(false); }}
              placeholder="https://..."
              className="w-full rounded-lg border border-[var(--border-default)] px-3 py-2 text-sm font-heebo focus:outline-none focus:ring-2 focus:ring-brand-gold/40 mb-4"
              dir="ltr"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setLinkDialogOpen(false)} className="px-4 py-2 text-sm font-heebo text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">ביטול</button>
              <button type="button" onClick={handleConfirmLink} className="px-4 py-2 text-sm font-heebo bg-brand-navy text-white rounded-lg hover:bg-brand-navy/90 transition-colors">אישור</button>
            </div>
          </div>
        </div>
      )}

      {/* Signature */}
      <div className="rounded-lg border border-[var(--border-default)] overflow-hidden">
        <button type="button" onClick={() => setSignatureOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-[var(--bg-surface-raised)] text-sm font-medium font-heebo text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] transition-colors focus-visible:outline-none"
          aria-expanded={signatureOpen}
        >
          <span>חתימה — תצורף בסוף התשובה</span>
          {signatureOpen ? <ChevronUp size={15} strokeWidth={2} /> : <ChevronDown size={15} strokeWidth={2} />}
        </button>
        {signatureOpen && (
          <div className="px-4 py-3 bg-[var(--bg-surface)] border-t border-[var(--border-default)]">
            {signature
              ? <p className="text-sm text-[var(--text-secondary)] font-heebo whitespace-pre-wrap leading-relaxed" dir="rtl">{signature}</p>
              : <p className="text-sm text-[var(--text-muted)] font-heebo italic">לא הוגדרה חתימה בפרופיל.</p>}
          </div>
        )}
      </div>

      {saveError && <p role="alert" className="text-sm text-red-600 font-heebo px-1">{saveError}</p>}

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="md" loading={savingDraft} onClick={handleSaveDraft}>שמור טיוטה</Button>
        <Button variant="secondary" size="md" onClick={() => setPublishModalOpen(true)} disabled={savingDraft || !charCount}>פרסם תשובה</Button>
      </div>

      <PublishConfirmModal
        isOpen={publishModalOpen}
        onClose={() => setPublishModalOpen(false)}
        editorHtml={editor.getHTML()}
        signature={signature}
        onConfirm={handlePublishConfirm}
      />

      <style>{`
        .answer-editor-content.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: var(--text-muted);
          pointer-events: none;
          position: absolute;
          top: 0; right: 0;
          padding: 1rem 1.25rem;
          font-family: 'Heebo', sans-serif;
        }
        .answer-editor-content h1 { font-size: 1.5rem; font-weight: 800; color: var(--color-navy); margin: 1.25rem 0 0.6rem; font-family: 'Heebo', sans-serif; }
        .answer-editor-content h2 { font-size: 1.25rem; font-weight: 700; color: var(--color-navy); margin: 1.1rem 0 0.5rem; font-family: 'Heebo', sans-serif; }
        .answer-editor-content h3 { font-size: 1.05rem; font-weight: 600; color: var(--color-navy); margin: 1rem 0 0.4rem; font-family: 'Heebo', sans-serif; }
        .answer-editor-content p  { margin-bottom: 0.6rem; line-height: 1.9; }
        .answer-editor-content ul, .answer-editor-content ol { padding-inline-start: 1.5rem; margin-bottom: 0.75rem; }
        .answer-editor-content li { margin-bottom: 0.3rem; line-height: 1.75; }
        .answer-editor-content blockquote { border-inline-start: 3px solid var(--color-gold); padding-inline-start: 1rem; margin-inline-start: 0; color: var(--text-secondary); font-style: italic; margin-bottom: 0.75rem; }
        .answer-editor-content strong { font-weight: 700; color: var(--text-primary); }
        .answer-editor-content a { color: #2563eb; text-decoration: underline; }
        .answer-editor-content mark { border-radius: 2px; padding: 0 2px; }
        .answer-editor-content hr { border: none; border-top: 2px solid var(--border-default); margin: 1.25rem 0; }
      `}</style>
    </div>
  );
}
