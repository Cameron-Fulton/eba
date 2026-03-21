/**
 * Pure mergePackets() function — merges N MemoryPackets into 1.
 * No I/O, no side effects, fully unit-testable.
 * Implements 10 merge rules with 3 never-drop fields.
 */

import { randomUUID } from 'crypto';
import {
  MemoryPacket, Entity, VocabularyEntry, SessionMeta,
} from '../phase1/memory-packet';

function normalizeForDedup(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

const SEVERITY_ORDER: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const THREAD_PRIORITY: Record<string, number> = {
  backlog: 0,
  active: 1,
  next_up: 2,
  blocked: 3,
};

/**
 * Merge N packets into 1. Pure function.
 * Throws if packets array is empty.
 * Returns shallow copy for single packet.
 */
export function mergePackets(packets: MemoryPacket[]): MemoryPacket {
  if (packets.length === 0) {
    throw new Error('mergePackets requires at least one packet');
  }
  if (packets.length === 1) {
    return { ...packets[0] };
  }

  // Rule 1: rejected_ideas — accumulate, dedup by normalizeForDedup(idea), first wins
  const rejectedMap = new Map<string, typeof packets[0]['rejected_ideas'][0]>();
  for (const pkt of packets) {
    for (const ri of pkt.rejected_ideas) {
      const key = normalizeForDedup(ri.idea);
      if (!rejectedMap.has(key)) {
        rejectedMap.set(key, ri);
      }
    }
  }

  // Rule 2: decisions — later timestamp overrides, dedup by normalizeForDedup(description)
  const decisionMap = new Map<string, typeof packets[0]['decisions'][0]>();
  for (const pkt of packets) {
    for (const d of pkt.decisions) {
      const key = normalizeForDedup(d.description);
      const existing = decisionMap.get(key);
      if (!existing || d.timestamp > existing.timestamp) {
        decisionMap.set(key, d);
      }
    }
  }

  // Rule 3: risks — accumulate, higher severity wins on dedup by normalizeForDedup(description)
  const riskMap = new Map<string, typeof packets[0]['risks'][0]>();
  for (const pkt of packets) {
    for (const r of pkt.risks) {
      const key = normalizeForDedup(r.description);
      const existing = riskMap.get(key);
      if (!existing || SEVERITY_ORDER[r.severity] > SEVERITY_ORDER[existing.severity]) {
        riskMap.set(key, r);
      }
    }
  }

  // Rule 4: open_threads — merge by topic, blocked is sticky, higher priority wins, later context replaces
  const threadMap = new Map<string, typeof packets[0]['open_threads'][0]>();
  for (const pkt of packets) {
    for (const t of pkt.open_threads) {
      const key = normalizeForDedup(t.topic);
      const existing = threadMap.get(key);
      if (!existing) {
        threadMap.set(key, { ...t });
      } else {
        // blocked is sticky
        const wasBlocked = existing.status === 'blocked';
        const higherPriority =
          THREAD_PRIORITY[t.status] > THREAD_PRIORITY[existing.status]
            ? t.status
            : existing.status;
        const mergedStatus = wasBlocked ? 'blocked' : higherPriority;

        // Later context replaces if non-empty
        const context = t.context && t.context.length > 0 ? t.context : existing.context;

        threadMap.set(key, {
          ...existing,
          status: mergedStatus as typeof t.status,
          context,
          blocked_reason: existing.blocked_reason || t.blocked_reason,
        });
      }
    }
  }

  // Rule 5: key_file_changes — last packet's entry wins per path
  const fileMap = new Map<string, typeof packets[0]['key_file_changes'][0]>();
  for (const pkt of packets) {
    for (const fc of pkt.key_file_changes) {
      fileMap.set(fc.path, fc);
    }
  }

  // Rule 6: entities — accumulate, dedup by name, later relationship overrides, urls+also unioned
  const entityMap = new Map<string, Entity>();
  for (const pkt of packets) {
    for (const e of pkt.entities ?? []) {
      const key = normalizeForDedup(e.name);
      const existing = entityMap.get(key);
      if (!existing) {
        entityMap.set(key, { ...e, urls: [...e.urls], also: [...e.also] });
      } else {
        existing.relationship = e.relationship;
        const urlSet = new Set([...existing.urls, ...e.urls]);
        existing.urls = [...urlSet];
        const alsoSet = new Set([...existing.also, ...e.also]);
        existing.also = [...alsoSet];
      }
    }
  }

  // Rule 7: vocabulary — accumulate, dedup by term, first wins
  const vocabMap = new Map<string, VocabularyEntry>();
  for (const pkt of packets) {
    for (const v of pkt.vocabulary ?? []) {
      const key = normalizeForDedup(v.term);
      if (!vocabMap.has(key)) {
        vocabMap.set(key, v);
      }
    }
  }

  // Rule 8: summary — concatenate with separator
  const summary = packets.map(p => p.summary).join('\n---\n');

  // Rule 9: metadata — recompute
  const totalOriginal = packets.reduce((s, p) => s + p.metadata.original_token_count, 0);
  const weightedFidelity = packets.reduce(
    (s, p) => s + p.metadata.fidelity_score * p.metadata.original_token_count,
    0,
  );
  const fidelityScore = totalOriginal > 0 ? weightedFidelity / totalOriginal : 0;

  // Estimate compressed token count from merged output size
  const mergedContent = JSON.stringify({
    decisions: [...decisionMap.values()],
    rejected_ideas: [...rejectedMap.values()],
    risks: [...riskMap.values()],
    open_threads: [...threadMap.values()],
    key_file_changes: [...fileMap.values()],
    summary,
  });
  const compressedTokenCount = Math.ceil(mergedContent.length / 4);
  const compressionRatio = totalOriginal > 0
    ? totalOriginal / Math.max(compressedTokenCount, 1)
    : 1;

  // Rule 10: session_meta — union load_bearing_sections, concat rationale
  const allSections = new Set<string>();
  const rationales: string[] = [];
  for (const pkt of packets) {
    if (pkt.session_meta) {
      for (const s of pkt.session_meta.load_bearing_sections ?? []) {
        allSections.add(s);
      }
      if (pkt.session_meta.token_budget_rationale) {
        rationales.push(pkt.session_meta.token_budget_rationale);
      }
    }
  }
  const hasSessionMeta = allSections.size > 0 || rationales.length > 0;

  // Build entities/vocabulary — undefined when empty (not empty array)
  const entitiesArr = [...entityMap.values()];
  const vocabArr = [...vocabMap.values()];

  const merged: MemoryPacket = {
    id: `pkt_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    session_id: packets[packets.length - 1].session_id,
    summary,
    decisions: [...decisionMap.values()],
    rejected_ideas: [...rejectedMap.values()],
    risks: [...riskMap.values()],
    open_threads: [...threadMap.values()],
    key_file_changes: [...fileMap.values()],
    metadata: {
      original_token_count: totalOriginal,
      compressed_token_count: compressedTokenCount,
      compression_ratio: compressionRatio,
      fidelity_score: fidelityScore,
    },
  };

  if (entitiesArr.length > 0) {
    merged.entities = entitiesArr;
  }
  if (vocabArr.length > 0) {
    merged.vocabulary = vocabArr;
  }
  if (hasSessionMeta) {
    merged.session_meta = {
      load_bearing_sections: allSections.size > 0 ? [...allSections] : undefined,
      token_budget_rationale: rationales.length > 0 ? rationales.join('\n') : undefined,
    };
  }

  return merged;
}
