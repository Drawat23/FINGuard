import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  BookOpen,
  Bot,
  CheckCircle2,
  FileText,
  Send,
  ShieldAlert,
  Sparkles,
  Upload,
} from 'lucide-react';
import type { CopilotResponse, RagCitation, RagDocumentRecord } from '../../shared/types.ts';
import { apiFetch, formatInr } from '../lib/api.ts';
import { BottomSheet } from './BottomSheet.tsx';
import { InfoHint, MATERIAL_EASE, MaterialSegmentedTabs } from './MotionPrimitives.tsx';

interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  mode: CopilotResponse['mode'];
  citations?: RagCitation[];
  toolsUsed?: string[];
  riskVerdict?: CopilotResponse['riskVerdict'];
}

interface CopilotSheetProps {
  open: boolean;
  onClose: () => void;
  initialMode?: CopilotResponse['mode'];
  initialPrompt?: string;
}

export const CopilotSheet: React.FC<CopilotSheetProps> = ({
  open,
  onClose,
  initialMode = 'RESEARCH',
  initialPrompt = '',
}) => {
  const [subView, setSubView] = useState<'CHAT' | 'VAULT'>('CHAT');
  const [mode, setMode] = useState<CopilotResponse['mode']>(initialMode);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [activeCitation, setActiveCitation] = useState<RagCitation | null>(null);

  // Document Vault state
  const [docs, setDocs] = useState<RagDocumentRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');

  useEffect(() => {
    setMode(initialMode);
    if (initialPrompt) {
      setInput(initialPrompt);
      setSubView('CHAT');
    }
  }, [initialMode, initialPrompt, open]);

  const loadDocuments = async () => {
    try {
      const res = await apiFetch<{ documents: RagDocumentRecord[] }>('/api/rag/documents');
      setDocs(res.documents);
    } catch {
      // ignore if unauthenticated
    }
  };

  useEffect(() => {
    if (open) {
      void loadDocuments();
    }
  }, [open]);

  const sendQuery = async (customQuery?: string, customMode?: CopilotResponse['mode']) => {
    const q = (customQuery ?? input).trim();
    const activeMode = customMode ?? mode;
    if (!q || loading) return;

    setInput('');
    setError(null);
    const userMsg: CopilotMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: q,
      mode: activeMode,
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await apiFetch<CopilotResponse>('/api/copilot/ask', {
        method: 'POST',
        body: JSON.stringify({ query: q, mode: activeMode }),
      });
      setMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          text: res.answer,
          mode: res.mode,
          citations: res.citations,
          toolsUsed: res.toolsUsed,
          riskVerdict: res.riskVerdict,
        },
      ]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadStatus(null);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('title', file.name);
      form.append('category', 'Uploaded Filing / Note');
      const res = await apiFetch<{ document: RagDocumentRecord }>('/api/rag/upload', {
        method: 'POST',
        body: form,
      });
      setUploadStatus(`Indexed "${res.document.title}" (${res.document.chunkCount} vector chunks).`);
      await loadDocuments();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleTextIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteTitle.trim() || !pasteText.trim()) return;
    setUploading(true);
    setUploadStatus(null);
    setError(null);
    try {
      const res = await apiFetch<{ document: RagDocumentRecord }>('/api/rag/upload', {
        method: 'POST',
        body: JSON.stringify({
          title: pasteTitle.trim(),
          category: 'Research Note',
          text: pasteText.trim(),
        }),
      });
      setPasteTitle('');
      setPasteText('');
      setUploadStatus(`Indexed "${res.document.title}" (${res.document.chunkCount} chunks).`);
      await loadDocuments();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const quickChips = [
    {
      title: 'Roast Portfolio & MF Overlap',
      prompt: 'Roast my portfolio & check MF overlap',
      mode: 'PORTFOLIO_DIAGNOSTIC' as const,
    },
    {
      title: 'Check TATAMOTORS 3x Tip',
      prompt: 'Verify tip: Buy TATAMOTORS.NS for guaranteed 3x in 6 months',
      mode: 'BS_DETECTOR' as const,
    },
    {
      title: 'FY26 STCG & LTCG Tax Rules',
      prompt: 'Explain FY26 STCG 20% vs LTCG ₹1.25L exemption rules',
      mode: 'RESEARCH' as const,
    },
    {
      title: 'India VIX Gold Hedge Rule',
      prompt: 'When should I shift into GOLDBEES.NS using India VIX?',
      mode: 'RESEARCH' as const,
    },
  ];

  return (
    <>
      <BottomSheet
        open={open}
        onClose={onClose}
        title="FINGuard AI Copilot"
        subtitle="Hybrid RAG · BS-Detector · Wealth Agent"
        maxWidthClass="lg:max-w-3xl"
      >
        <div className="flex flex-col h-[68dvh]">
          {/* Material 3 Sliding Switcher: Chat vs Document Vault */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/80 dark:border-white/8">
            <MaterialSegmentedTabs
              layoutGroupId="copilotSubView"
              activeId={subView}
              onChange={setSubView}
              items={[
                { id: 'CHAT', label: 'Copilot Chat' },
                { id: 'VAULT', label: `Doc Vault (${docs.length})` },
              ]}
            />

            {subView === 'CHAT' && (
              <MaterialSegmentedTabs
                layoutGroupId="copilotMode"
                activeId={mode}
                onChange={setMode}
                items={[
                  { id: 'RESEARCH', label: 'RAG Q&A' },
                  { id: 'BS_DETECTOR', label: 'BS-Detector' },
                  { id: 'PORTFOLIO_DIAGNOSTIC', label: 'Portfolio Audit' },
                ]}
              />
            )}
          </div>

          <AnimatePresence mode="wait">
          {subView === 'VAULT' ? (
            <motion.div
              key="vault"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: MATERIAL_EASE }}
              className="flex-1 overflow-y-auto py-4 space-y-5"
            >
              <div className="rounded-3xl m3-tonal-box border border-slate-200/80 dark:border-white/8 p-4 sm:p-5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <Upload className="w-4 h-4 text-[#FFB020]" />
                    <span>Upload Report or Note (.pdf / .txt)</span>
                  </h3>
                  <InfoHint text="Chunks financial filings and notes for fast portfolio Q&A." />
                </div>

                <div className="mt-3">
                  <label className="inline-flex min-h-[42px] px-4 py-2 rounded-xl bg-[#FFB020] hover:bg-[#F59E0B] text-[#1C1000] text-xs font-semibold cursor-pointer items-center gap-2 transition-colors">
                    <Upload className="w-4 h-4" />
                    <span>{uploading ? 'Indexing...' : 'Select File'}</span>
                    <input
                      type="file"
                      accept=".pdf,.txt,.md,.csv"
                      disabled={uploading}
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                <form onSubmit={handleTextIngest} className="mt-4 pt-4 border-t border-slate-200 dark:border-white/8 space-y-2.5">
                  <input
                    type="text"
                    value={pasteTitle}
                    onChange={(e) => setPasteTitle(e.target.value)}
                    placeholder="Title (e.g., Infosys Q3 Concall)"
                    className="w-full min-h-[40px] px-3 rounded-xl bg-white dark:bg-[#111622] border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
                  />
                  <textarea
                    rows={3}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder="Paste financial notes..."
                    className="w-full p-3 rounded-xl bg-white dark:bg-[#111622] border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
                  />
                  <button
                    type="submit"
                    disabled={uploading || !pasteTitle.trim() || !pasteText.trim()}
                    className="min-h-[38px] px-4 py-1.5 rounded-xl bg-slate-900 dark:bg-white/10 text-white text-xs font-medium disabled:opacity-50"
                  >
                    Index Note
                  </button>
                </form>

                {uploadStatus && (
                  <p className="text-xs text-[#D97706] dark:text-[#FFB020] mt-2">{uploadStatus}</p>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Knowledge Base ({docs.length})
                </h4>
                {docs.map((d) => (
                  <div
                    key={d.id}
                    className="p-3.5 rounded-xl bg-slate-50 dark:bg-white/4 border border-slate-200 dark:border-white/8 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText className="w-4 h-4 text-[#FFB020] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {d.title}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {d.category} · {d.chunkCount} chunks ·{' '}
                          {d.sourceType === 'PRE_SEEDED' ? 'Built-in' : 'Uploaded'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="chat"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: MATERIAL_EASE }}
              className="flex-1 flex flex-col min-h-0"
            >
              {/* Messages Thread */}
              <div className="flex-1 overflow-y-auto py-4 space-y-4">
                {messages.length === 0 && (
                  <div className="space-y-3.5">
                    <div className="p-4 rounded-3xl m3-tonal-box border border-slate-200/80 dark:border-white/8 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 text-[#D97706] dark:text-[#FFB020]">
                        <Bot className="w-5 h-5 shrink-0" />
                        <p className="font-display text-sm font-bold text-slate-900 dark:text-white">
                          Wealth Copilot
                        </p>
                      </div>
                      <InfoHint text="Uses market prices, your portfolio ledger, and indexed filings." />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {quickChips.map((chip) => (
                        <button
                          key={chip.title}
                          type="button"
                          onClick={() => {
                            setMode(chip.mode);
                            void sendQuery(chip.prompt, chip.mode);
                          }}
                          className="text-left p-3.5 rounded-2xl m3-tonal-box m3-card-interactive border border-slate-200/70 dark:border-white/8 text-xs text-slate-800 dark:text-slate-200 transition-all"
                        >
                          <span className="font-semibold text-[#D97706] dark:text-[#FFB020] block mb-0.5">
                            {chip.mode === 'BS_DETECTOR'
                              ? 'BS-Detector'
                              : chip.mode === 'PORTFOLIO_DIAGNOSTIC'
                              ? 'Portfolio Audit'
                              : 'RAG Research'}
                          </span>
                          {chip.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-[92%] rounded-2xl p-4 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === 'user'
                          ? 'bg-[#FFB020] text-[#1C1000] font-medium'
                          : 'bg-slate-50 dark:bg-[#0B0F19] border border-slate-200 dark:border-white/10 text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {/* BS-Detector Verdict Card */}
                      {msg.riskVerdict && (
                        <div
                          className={`mb-3 p-3 rounded-xl border ${
                            msg.riskVerdict.verdict === 'HIGH_RISK_HYPE'
                              ? 'bg-[#FF4D6D]/10 border-[#FF4D6D]/30 text-[#E11D48] dark:text-[#FF4D6D]'
                              : msg.riskVerdict.verdict === 'CAUTION_SPECULATIVE'
                              ? 'bg-[#F5B700]/10 border-[#F5B700]/30 text-[#D97706] dark:text-[#F5B700]'
                              : 'bg-[#FFB020]/10 border-[#FFB020]/30 text-[#D97706] dark:text-[#FFB020]'
                          }`}
                        >
                          <div className="flex items-center gap-2 font-semibold text-xs">
                            {msg.riskVerdict.verdict === 'HIGH_RISK_HYPE' ? (
                              <ShieldAlert className="w-4 h-4 shrink-0" />
                            ) : msg.riskVerdict.verdict === 'CAUTION_SPECULATIVE' ? (
                              <AlertTriangle className="w-4 h-4 shrink-0" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4 shrink-0" />
                            )}
                            <span>{msg.riskVerdict.headline}</span>
                          </div>
                          {msg.riskVerdict.symbolChecked && (
                            <p className="text-[11px] mt-1 opacity-90 tabular-nums">
                              {msg.riskVerdict.symbolChecked} · Price:{' '}
                              {formatInr(msg.riskVerdict.priceInr || 0, true)} · 1Y Return:{' '}
                              {msg.riskVerdict.oneYearReturnPct}% · Vol: {msg.riskVerdict.volatilityPct}%
                            </p>
                          )}
                        </div>
                      )}

                      {msg.text}

                      {/* Clickable Source/Page Citation Buttons */}
                      {msg.citations && msg.citations.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-white/10">
                          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
                            <BookOpen className="w-3.5 h-3.5" />
                            <span>Sources (tap to view):</span>
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.citations.map((cit) => (
                              <button
                                key={cit.chunkId}
                                type="button"
                                onClick={() => setActiveCitation(cit)}
                                className="min-h-[30px] px-2.5 py-1 rounded-lg bg-white dark:bg-white/6 hover:bg-slate-100 dark:hover:bg-white/12 border border-slate-200 dark:border-white/10 text-[11px] font-medium text-slate-700 dark:text-slate-300 transition-colors text-left"
                              >
                                {cit.docTitle} · {cit.pageOrSection}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-white/5 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 max-w-xs">
                    <Sparkles className="w-4 h-4 text-[#FFB020] animate-spin" />
                    <span>Running Hybrid RAG &amp; quant tools...</span>
                  </div>
                )}

                {error && (
                  <div className="p-3 rounded-xl bg-[#FF4D6D]/10 border border-[#FF4D6D]/30 text-xs text-[#E11D48] dark:text-[#FF4D6D]">
                    {error}
                  </div>
                )}
              </div>

              {/* Input Footer */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendQuery();
                }}
                className="pt-3 border-t border-slate-200 dark:border-white/8 flex items-center gap-2"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    mode === 'BS_DETECTOR'
                      ? 'Paste stock tip or reel claim...'
                      : mode === 'PORTFOLIO_DIAGNOSTIC'
                      ? 'Ask to audit holdings or overlap...'
                      : 'Ask about FY26 tax, VIX, or filings...'
                  }
                  className="flex-1 min-h-[46px] px-4 rounded-xl bg-slate-100 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#FFB020]"
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  aria-label="Send message"
                  className="min-h-[46px] min-w-[46px] px-4 rounded-2xl bg-[#FFB020] hover:bg-[#F59E0B] active:scale-[0.97] text-[#1C1000] font-semibold flex items-center justify-center transition-all disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </motion.div>
          )}
          </AnimatePresence>
        </div>
      </BottomSheet>

      {/* Source Citation Preview Bottom Sheet */}
      <BottomSheet
        open={Boolean(activeCitation)}
        onClose={() => setActiveCitation(null)}
        title={activeCitation?.docTitle || 'Source Excerpt'}
        subtitle={
          activeCitation
            ? `${activeCitation.pageOrSection} · Relevance ${(activeCitation.score * 100).toFixed(0)}%`
            : undefined
        }
        maxWidthClass="lg:max-w-lg"
      >
        {activeCitation && (
          <div className="space-y-3">
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#07090F] border border-slate-200 dark:border-white/10 text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
              {activeCitation.excerpt}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              Chunk ID: {activeCitation.chunkId}
            </p>
          </div>
        )}
      </BottomSheet>
    </>
  );
};
