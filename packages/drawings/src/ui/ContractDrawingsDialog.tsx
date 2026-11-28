"use client";

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { FileText, Link2, Loader2, Plus } from "lucide-react";
import { Badge } from "@gmd/ui/components/badge";
import { Button } from "@gmd/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@gmd/ui/components/dialog";
import { Input } from "@gmd/ui/components/input";
import { Label } from "@gmd/ui/components/label";
import { Segmented } from "@gmd/ui/components/segmented";
import { Textarea } from "@gmd/ui/components/textarea";
import { cn } from "@gmd/ui/lib/utils";
import {
  DOC_TYPES,
  MAX_PDFS_PER_CALL,
  checkMove,
  checkPdfs,
  daysAtStage,
  movesFor,
  revLabel,
  type ContractDrawings,
  type ContractInfo,
  type ContractLine,
  type DrawingEntry,
  type DrawingMove,
  type DrawingStatus,
  type NewDrawingInput,
} from "../columns";

// One contract's Drawings & QAP window, opened from the Drawings page and from Contract Review: the
// contract's header, each current drawing with its files and history, and for editors and the
// verifier (Washim) the forms that change them. It reaches the server only through the host's
// `actions`; the package rules there decide, and their refusals show inline.

/** What every host action returns: the package's DrawingResult, or the host's own refusal. */
export type DrawingActionResult<T> = { success: true; data: T } | { success: false; error: string; code?: string; suggestion?: string };
type Failure = Extract<DrawingActionResult<unknown>, { success: false }>;
type Call = () => Promise<DrawingActionResult<unknown>>;
type Send = (call: Call) => Promise<Failure | null>;

/** The signed-in user's role as the host decided it. It only picks which controls show. */
export interface DrawingRights {
  role: "verifier" | "editor" | "viewer";
}

/** One status move and what travels with it: the host uploads `files` (PDFs), then records them with `links` in the same step. */
export interface StatusChange {
  /** The status the user saw; the server refuses the move if it changed meanwhile. */
  from: string;
  to: string;
  comment: string;
  files: File[];
  links: string[];
}

/** Server actions behind the window. The host owns auth and builds the actor. */
export interface ContractDrawingsActions {
  /** getContractDrawings. */
  loadContract: (contractNo: string) => Promise<DrawingActionResult<ContractDrawings>>;
  /** suggestNextDrawingNo. */
  suggestNo: () => Promise<DrawingActionResult<string>>;
  /** createDrawing. */
  create: (input: NewDrawingInput) => Promise<DrawingActionResult<DrawingEntry>>;
  /** uploadDrawingPdfs(files), then addFilesOrLinks with those files and `links`. */
  attach: (drawingId: string, files: File[], links: string[]) => Promise<DrawingActionResult<DrawingEntry>>;
  /** uploadDrawingPdfs(step.files), then changeStatus with those files and `step.links`. */
  changeStatus: (drawingId: string, step: StatusChange) => Promise<DrawingActionResult<DrawingEntry>>;
  /** newRevision. */
  newRevision: (drawingId: string, comment: string) => Promise<DrawingActionResult<DrawingEntry>>;
}

export interface ContractDrawingsDialogProps {
  /** A contract no (a PO no also resolves). */
  contractNo: string;
  open: boolean;
  onClose: () => void;
  actions: ContractDrawingsActions;
  rights: DrawingRights;
}

const APPROVED: DrawingStatus = "Approved by client";
const SUPERSEDED: DrawingStatus = "Superseded";
const LATE_DAYS = 7;
const FLANGE_DRILLINGS = ["IS 1538", "IS 9523", "BS 4504"];
const PREPARERS = ["Claude", "Washim"];
const BLANK_DRAWING = { drawingNo: "", rev: "0", docType: "", product: "", pn: "", standard: "", flangeDrilling: "", preparedBy: "", remarks: "" };

const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
const stamp = (iso: string) => when.format(new Date(iso));
const statusVariant = (status: string) =>
  status === APPROVED ? "default" : status === "Correction required" ? "destructive" : status === SUPERSEDED ? "secondary" : "outline";

/** A thrown call (network, a body over the size limit) comes back as a failure, like a refused one. */
async function attempt<T>(call: () => Promise<DrawingActionResult<T>>, failed = "Upload failed: files too large or connection lost. Nothing was saved."): Promise<DrawingActionResult<T>> {
  try {
    return await call();
  } catch {
    // Raw text from a body-limit or network failure means nothing to the user; the framework rejects before anything is saved.
    return { success: false, error: failed };
  }
}

/** Days at the current stage; a drawing still waiting after a week is flagged. */
export function DaysAtStage({ days, status }: { days: number | null; status: string }) {
  if (days === null) return null;
  // shortcut: one 7-day limit for every stage; make it per stage if Puja wants different limits.
  if (days < LATE_DAYS || status === APPROVED) return <>{days}</>;
  return (
    <Badge variant="destructive" title={`${LATE_DAYS} or more days at this stage`}>
      {days}
    </Badge>
  );
}

export function ContractDrawingsDialog({ contractNo, open, onClose, actions, rights }: ContractDrawingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Drawings &amp; QAP — {contractNo}</DialogTitle>
          <DialogDescription>
            {rights.role === "viewer" ? "View and download this contract's drawings." : "Add drawings, attach files and move each drawing through approval."} A new
            revision keeps the old one and its files; nothing is ever deleted.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed: another contract starts from a fresh load and empty forms. */}
        <WindowBody key={contractNo} contractNo={contractNo} actions={actions} rights={rights} />
      </DialogContent>
    </Dialog>
  );
}

function WindowBody({ contractNo, actions, rights }: Omit<ContractDrawingsDialogProps, "open" | "onClose">) {
  const { loadContract } = actions;
  const [res, setRes] = useState<DrawingActionResult<ContractDrawings> | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => setRes(await attempt(() => loadContract(contractNo), "Could not load the drawings. Check the connection and try again.")), [loadContract, contractNo]);
  useEffect(() => {
    void reload();
  }, [reload]);

  // One call at a time. A success, or a drawing someone else changed meanwhile, reloads the contract.
  const send = useCallback<Send>(
    async (call) => {
      setBusy(true);
      try {
        const out = await attempt(call);
        if (out.success || out.code === "stale") await reload();
        if (out.success) return null;
        // The server's wording says "reload", but the window has just reloaded itself.
        return out.code === "stale" ? { ...out, error: "This drawing was changed meanwhile. The window is refreshed; check it and try again." } : out;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  if (!res) {
    return (
      <p className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> Loading drawings…
      </p>
    );
  }
  if (!res.success) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-destructive">{res.error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setRes(null);
            void reload();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  const { contract, drawings } = res.data;
  const current = drawings.filter((d) => d.status !== SUPERSEDED);
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs sm:grid-cols-3">
        <Fact label="Contract no." value={contract.contractNo} />
        <Fact label="Contractor" value={contract.contractor} />
        <Fact label="Client" value={contract.client} />
        <Fact label="Project" value={contract.project} />
        <Fact label="PO no." value={contract.poNo} />
        <Fact label="Contract / PO date" value={contract.contractDate} />
      </dl>
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold tracking-tight">Drawings</h3>
          <span className="text-sm tabular-nums text-muted-foreground">{current.length}</span>
          {rights.role !== "viewer" && !adding && (
            <Button size="sm" className="ml-auto" disabled={busy} onClick={() => setAdding(true)}>
              <Plus />
              Add drawing
            </Button>
          )}
        </div>
        {adding && <AddDrawingForm contract={contract} actions={actions} busy={busy} send={send} onDone={() => setAdding(false)} />}
        {current.length === 0 && !adding && (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">No drawings for this contract yet.</p>
        )}
        {current.map((d) => (
          <DrawingCard
            key={d.id}
            entry={d}
            older={drawings.filter((o) => o.drawingNo === d.drawingNo && o.id !== d.id)}
            actions={actions}
            role={rights.role}
            busy={busy}
            send={send}
            lines={contract.lines}
          />
        ))}
      </section>
    </div>
  );
}

interface CardProps {
  entry: DrawingEntry;
  /** Its superseded revisions, newest first. */
  older: DrawingEntry[];
  actions: ContractDrawingsActions;
  role: DrawingRights["role"];
  busy: boolean;
  send: Send;
  lines: ContractLine[];
}

type Panel = "status" | "attach" | "revision";

/** One current drawing: details, files, history and its controls, with the earlier revisions folded under it. */
function DrawingCard({ entry, older, actions, role, busy, send, lines }: CardProps) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const moves = movesFor(entry.status, role);
  const done = () => setPanel(null);
  const toggle = (name: Panel, label: string) => (
    <Button size="sm" variant={panel === name ? "secondary" : "outline"} aria-expanded={panel === name} disabled={busy} onClick={() => setPanel(panel === name ? null : name)}>
      {label}
    </Button>
  );

  return (
    <article aria-label={`${entry.drawingNo} ${revLabel(entry.rev)}`} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <EntryHeading entry={entry} />
      <EntryDetails entry={entry} lines={lines} />
      {role !== "viewer" && (
        <div className="flex flex-wrap gap-2">
          {moves.length > 0 && toggle("status", "Change status")}
          {toggle("attach", "Attach files")}
          {toggle("revision", "New revision")}
        </div>
      )}
      {panel === "status" && <StatusForm entry={entry} role={role} moves={moves} changeStatus={actions.changeStatus} busy={busy} send={send} onDone={done} />}
      {panel === "attach" && <AttachForm entry={entry} attach={actions.attach} busy={busy} send={send} onDone={done} />}
      {panel === "revision" && <RevisionForm entry={entry} newRevision={actions.newRevision} busy={busy} send={send} onDone={done} />}
      {older.length > 0 && (
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">Earlier revisions ({older.length})</summary>
          <div className="flex flex-col divide-y divide-border border-t border-border">
            {older.map((o) => (
              <div key={o.id} className="flex flex-col gap-3 p-3">
                <EntryHeading entry={o} />
                <EntryDetails entry={o} lines={lines} />
              </div>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}

function EntryHeading({ entry }: { entry: DrawingEntry }) {
  const days = daysAtStage(entry.statusAt, new Date());
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <h4 className="font-mono text-sm font-semibold tabular-nums">{entry.drawingNo}</h4>
      <span className="text-xs font-semibold tabular-nums text-muted-foreground">{revLabel(entry.rev)}</span>
      <span className="text-xs">{entry.docType}</span>
      <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={statusVariant(entry.status)} title={`${stamp(entry.statusAt)} · ${entry.statusBy}`}>
          {entry.status}
        </Badge>
        {entry.status === SUPERSEDED ? (
          <span className="tabular-nums">{stamp(entry.statusAt)}</span>
        ) : (
          <span className="flex items-center gap-1 tabular-nums">
            <DaysAtStage days={days} status={entry.status} /> {days === 1 ? "day" : "days"} at this stage
          </span>
        )}
      </span>
    </div>
  );
}

function EntryDetails({ entry, lines }: { entry: DrawingEntry; lines: ContractLine[] }) {
  const files = entry.events.filter((e) => e.fileUrl);
  const covered = entry.itemCodes.length
    ? entry.itemCodes
        .map((code) => {
          const line = lines.find((l) => l.itemCode === code);
          return [code, line?.itemName, line?.size].filter(Boolean).join(" ");
        })
        .join("; ")
    : "Whole contract";
  return (
    <>
      <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
        <Fact label="Product & sizes" value={entry.product} />
        <Fact label="PN" value={entry.pn} />
        <Fact label="Standard" value={entry.standard} />
        <Fact label="Flange drilling" value={entry.flangeDrilling} />
        <Fact label="Prepared by" value={entry.preparedBy} />
        <Fact label="Remarks" value={entry.remarks} />
        <Fact label="Lines covered" value={covered} className="sm:col-span-3" />
      </dl>
      <div className="flex flex-col gap-1.5 text-xs">
        <h5 className="font-medium text-muted-foreground">Files and links</h5>
        {files.length === 0 ? (
          <p className="text-muted-foreground">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {files.map((f) => {
              const Icon = f.sha256 ? FileText : Link2;
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <a
                    href={f.fileUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full min-w-0 items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline"
                  >
                    <Icon size={14} aria-hidden className="shrink-0" />
                    <span className="truncate">{f.fileName || f.fileUrl}</span>
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                  {f.final && <Badge title="The client-approved copy">FINAL</Badge>}
                  <span className="text-muted-foreground">
                    {f.by} · {stamp(f.at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer font-medium text-muted-foreground">History ({entry.events.length})</summary>
        <ol className="mt-2 flex flex-col gap-1.5 border-l border-border pl-3">
          {[...entry.events].reverse().map((e) => (
            <li key={e.id}>
              <span className="tabular-nums text-muted-foreground">{stamp(e.at)}</span> · {e.by} ·{" "}
              {e.status ? (
                <span className="font-medium">{e.status}</span>
              ) : (
                <>
                  attached {e.fileName || e.fileUrl}
                  {e.final && " (FINAL)"}
                </>
              )}
              {e.comment && <p className="whitespace-pre-wrap text-muted-foreground">{e.comment}</p>}
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}

function Fact({ label, value, className }: { label: string; value: string | null; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{value || "—"}</dd>
    </div>
  );
}

// ---- Forms ------------------------------------------------------------------------------------

/** A form's call: its failure stays on screen until the next try; a success closes the form. */
function useCall(send: Send, onDone: () => void) {
  const [failure, setFailure] = useState<Failure | null>(null);
  const [sending, setSending] = useState(false);
  const go = async (call: Call) => {
    setSending(true);
    setFailure(null);
    const failed = await send(call);
    setSending(false);
    if (failed) setFailure(failed);
    else onDone();
  };
  return { failure, setFailure, sending, go };
}

interface FormProps {
  busy: boolean;
  send: Send;
  onDone: () => void;
}

interface ActionFormProps {
  /** The form's accessible name. */
  label: string;
  submitLabel: string;
  canSubmit: boolean;
  busy: boolean;
  call: ReturnType<typeof useCall>;
  /** What is still missing, or what the submit will do. */
  hint?: string | null;
  onSubmit: () => void;
  onCancel: () => void;
  /** Offered with a number conflict: put the server's next free number in the form. */
  onUseSuggestion?: (drawingNo: string) => void;
  children: ReactNode;
}

function ActionForm({ label, submitLabel, canSubmit, busy, call, hint, onSubmit, onCancel, onUseSuggestion, children }: ActionFormProps) {
  const { failure, sending } = call;
  return (
    <form
      aria-label={label}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit && !busy) onSubmit();
      }}
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3"
    >
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {failure && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
          <span>{failure.error}</span>
          {failure.suggestion && onUseSuggestion && (
            <Button type="button" size="xs" variant="outline" onClick={() => onUseSuggestion(failure.suggestion!)}>
              Use {failure.suggestion}
            </Button>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={sending} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy || !canSubmit}>
          {sending && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function AddDrawingForm({ contract, actions, busy, send, onDone }: FormProps & { contract: ContractInfo; actions: ContractDrawingsActions }) {
  const id = useId();
  const call = useCall(send, onDone);
  const { setFailure } = call;
  const { suggestNo, create } = actions;
  const [v, setV] = useState(BLANK_DRAWING);
  const [tags, setTags] = useState<string[]>([]);
  const set = (key: keyof typeof BLANK_DRAWING) => (value: string) => setV((prev) => ({ ...prev, [key]: value }));
  // One tick per item code: a tag covers every line with that code.
  const taggable = useMemo(() => [...new Map(contract.lines.filter((l) => l.itemCode).map((l) => [l.itemCode, l])).values()], [contract.lines]);

  // The next free number, unless the user typed one first.
  useEffect(() => {
    let live = true;
    void attempt(suggestNo, "Could not fetch the next drawing number. Type one in.").then((res) => {
      if (!live) return;
      if (res.success) setV((prev) => (prev.drawingNo ? prev : { ...prev, drawingNo: res.data }));
      else setFailure(res);
    });
    return () => {
      live = false;
    };
  }, [suggestNo, setFailure]);

  return (
    <ActionForm
      label="Add drawing"
      submitLabel="Add drawing"
      canSubmit={Boolean(v.drawingNo.trim() && v.docType)}
      busy={busy}
      call={call}
      hint={!v.drawingNo.trim() ? "Enter the drawing no." : !v.docType ? "Pick the document type." : null}
      onCancel={onDone}
      onUseSuggestion={(no) => {
        set("drawingNo")(no);
        setFailure(null);
      }}
      onSubmit={() => void call.go(() => create({ ...v, contract: contract.contractNo, drawingNo: v.drawingNo.trim(), rev: Number(v.rev), itemCodes: tags }))}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Field label="Drawing no." htmlFor={`${id}-no`} hint="The next free number is filled in; type another to record an existing drawing.">
          <Input id={`${id}-no`} value={v.drawingNo} onChange={(e) => set("drawingNo")(e.target.value.toUpperCase())} className="font-mono uppercase" autoComplete="off" />
        </Field>
        <Field label="Rev" htmlFor={`${id}-rev`} hint={revLabel(Number(v.rev) || 0)}>
          <Input id={`${id}-rev`} type="number" min={0} step={1} value={v.rev} onChange={(e) => set("rev")(e.target.value)} />
        </Field>
      </div>
      <Choice label="Document type" options={DOC_TYPES} value={v.docType} onChange={set("docType")} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Product & sizes" htmlFor={`${id}-product`} className="sm:col-span-2">
          <Input id={`${id}-product`} value={v.product} onChange={(e) => set("product")(e.target.value)} />
        </Field>
        <Field label="PN" htmlFor={`${id}-pn`}>
          <Input id={`${id}-pn`} value={v.pn} onChange={(e) => set("pn")(e.target.value)} />
        </Field>
      </div>
      <Field label="Standard" htmlFor={`${id}-standard`}>
        <Input id={`${id}-standard`} value={v.standard} onChange={(e) => set("standard")(e.target.value)} placeholder="e.g. BS 5163, IS 14846, AWWA C512" />
      </Field>
      <Choice label="Flange drilling" options={FLANGE_DRILLINGS} value={v.flangeDrilling} onChange={set("flangeDrilling")} other />
      <Choice label="Prepared by" options={PREPARERS} value={v.preparedBy} onChange={set("preparedBy")} other />
      <Field label="Remarks" htmlFor={`${id}-remarks`}>
        <Textarea id={`${id}-remarks`} value={v.remarks} onChange={(e) => set("remarks")(e.target.value)} />
      </Field>
      {taggable.length > 0 && (
        <fieldset className="flex min-w-0 flex-col">
          <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Lines covered (tick none for the whole contract)</legend>
          <div className="max-h-44 overflow-y-auto rounded-lg border border-border bg-background">
            {taggable.map((l) => (
              <label key={l.itemCode} className="flex cursor-pointer items-center gap-2 border-b border-border px-2.5 py-1.5 text-xs last:border-b-0 hover:bg-muted/50">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={tags.includes(l.itemCode)}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setTags((prev) => (on ? [...prev, l.itemCode] : prev.filter((c) => c !== l.itemCode)));
                  }}
                />
                <span className="font-mono tabular-nums">{l.itemCode}</span>
                <span className="min-w-0 truncate text-muted-foreground">{[l.itemName, l.size, l.pnRating].filter(Boolean).join(" · ")}</span>
                {l.orderQty && <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">Qty {l.orderQty}</span>}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </ActionForm>
  );
}

function StatusForm({
  entry,
  role,
  moves,
  changeStatus,
  busy,
  send,
  onDone,
}: FormProps & { entry: DrawingEntry; role: DrawingRights["role"]; moves: DrawingMove[]; changeStatus: ContractDrawingsActions["changeStatus"] }) {
  const id = useId();
  const call = useCall(send, onDone);
  const [to, setTo] = useState<string>(moves.length === 1 ? moves[0].to : "");
  const [comment, setComment] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [link, setLink] = useState("");
  const need = moves.find((m) => m.to === to)?.needs;
  // Files travel only with a move that asks for them; a link counts only as the client's comments.
  const sent = need === "pdf" || need === "comment-or-file" ? files : [];
  const links = need === "comment-or-file" && link.trim() ? [link.trim()] : [];
  const pdfError = checkPdfs(sent);
  const refused = to ? checkMove(entry.status, to, role, { comment, files: sent.length + links.length, pdfs: sent.length }) : null;

  return (
    <ActionForm
      label={`Change the status of ${entry.drawingNo}`}
      submitLabel={to ? `Move to “${to}”` : "Move"}
      canSubmit={Boolean(to) && !refused && !pdfError}
      busy={busy}
      call={call}
      hint={to ? refused?.error : "Pick the new status."}
      onCancel={onDone}
      onSubmit={() => void call.go(() => changeStatus(entry.id, { from: entry.status, to, comment, files: sent, links }))}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">From “{entry.status}” to</span>
        <Segmented label="New status" options={moves.map((m) => ({ value: m.to, label: m.to }))} value={to} onChange={setTo} className="w-fit flex-wrap" />
      </div>
      <Field label={need === "comment" ? "Comment (required)" : "Comment"} htmlFor={`${id}-comment`}>
        <Textarea id={`${id}-comment`} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      {(need === "pdf" || need === "comment-or-file") && (
        <PdfField id={`${id}-files`} label={need === "pdf" ? "Client-approved PDF (required, marked FINAL)" : "Client's comments as PDF"} onChange={setFiles} error={pdfError} />
      )}
      {need === "comment-or-file" && <LinkField id={`${id}-link`} label="or a Drive link to them" value={link} onChange={setLink} />}
    </ActionForm>
  );
}

function AttachForm({ entry, attach, busy, send, onDone }: FormProps & { entry: DrawingEntry; attach: ContractDrawingsActions["attach"] }) {
  const id = useId();
  const call = useCall(send, onDone);
  const [files, setFiles] = useState<File[]>([]);
  const [link, setLink] = useState("");
  const links = link.trim() ? [link.trim()] : [];
  const pdfError = checkPdfs(files);
  return (
    <ActionForm
      label={`Attach files to ${entry.drawingNo}`}
      submitLabel="Attach"
      canSubmit={files.length + links.length > 0 && !pdfError}
      busy={busy}
      call={call}
      hint={entry.status === APPROVED ? "This drawing is approved by the client: files attached now are marked FINAL." : null}
      onCancel={onDone}
      onSubmit={() => void call.go(() => attach(entry.id, files, links))}
    >
      <PdfField id={`${id}-files`} label="PDF files" onChange={setFiles} error={pdfError} />
      <LinkField id={`${id}-link`} label="Drive link" value={link} onChange={setLink} />
    </ActionForm>
  );
}

function RevisionForm({ entry, newRevision, busy, send, onDone }: FormProps & { entry: DrawingEntry; newRevision: ContractDrawingsActions["newRevision"] }) {
  const id = useId();
  const call = useCall(send, onDone);
  const [comment, setComment] = useState("");
  const next = revLabel(entry.rev + 1);
  return (
    <ActionForm
      label={`New revision of ${entry.drawingNo}`}
      submitLabel={`Add ${next}`}
      canSubmit
      busy={busy}
      call={call}
      hint={`${revLabel(entry.rev)} turns Superseded and keeps its files; ${next} starts as “Draft prepared” with the same details.`}
      onCancel={onDone}
      onSubmit={() => void call.go(() => newRevision(entry.id, comment))}
    >
      <Field label={`What changes in ${next}`} htmlFor={`${id}-comment`}>
        <Textarea id={`${id}-comment`} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
    </ActionForm>
  );
}

function Field({ label, htmlFor, hint, className, children }: { label: string; htmlFor: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A few fixed options in one segmented row; with `other`, "Other" opens a free-text box. The value is the text either way. */
function Choice({ label, options, value, onChange, other }: { label: string; options: readonly string[]; value: string; onChange: (value: string) => void; other?: boolean }) {
  const [typing, setTyping] = useState(false);
  const isOther = Boolean(other) && (typing || (value !== "" && !options.includes(value)));
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label={label}
          options={[...options, ...(other ? ["Other"] : [])].map((o) => ({ value: o, label: o }))}
          value={isOther ? "Other" : value}
          onChange={(picked) => {
            setTyping(picked === "Other");
            onChange(picked === "Other" ? "" : picked);
          }}
          className="w-fit flex-wrap"
        />
        {isOther && <Input aria-label={`${label}, other`} autoFocus value={value} onChange={(e) => onChange(e.target.value)} className="w-56" />}
      </div>
    </div>
  );
}

function PdfField({ id, label, onChange, error }: { id: string; label: string; onChange: (files: File[]) => void; error: string | null }) {
  return (
    <Field label={label} htmlFor={id} hint={`PDF only: up to ${MAX_PDFS_PER_CALL} files of 25 MB each, 95 MB in all.`}>
      <Input
        id={id}
        type="file"
        multiple
        accept="application/pdf,.pdf"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(Array.from(e.target.files ?? []))}
        className="cursor-pointer text-xs"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </Field>
  );
}

function LinkField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label} htmlFor={id}>
      <Input id={id} type="url" value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://drive.google.com/…" />
    </Field>
  );
}
