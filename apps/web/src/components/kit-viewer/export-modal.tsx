'use client';

import React from 'react';
import type { CanonicalKit } from '../../types/kit.js';
import { Modal } from '../ui/modal.js';
import { Button } from '../ui/button.js';
import { Download, Copy, Check } from 'lucide-react';

export interface ExportModalProps {
  kit: CanonicalKit;
  isOpen: boolean;
  onClose: () => void;
}

export function ExportModal({ kit, isOpen, onClose }: ExportModalProps) {
  const [copied, setCopied] = React.useState(false);
  const jsonString = JSON.stringify(kit, null, 2);

  function handleDownload() {
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview-kit-${kit.source.company || 'export'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Export Canonical Kit"
      description="Exact Appendix A JSON structure without sidecar metadata. Strictly conformant."
    >
      <div className="space-y-4">
        <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 max-h-[360px] overflow-auto">
          <pre className="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap">
            {jsonString}
          </pre>
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-zinc-800">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopy}
            className="gap-1.5 font-mono text-xs"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy JSON</span>
              </>
            )}
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={handleDownload}
            className="gap-1.5 font-mono text-xs font-semibold"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download .json</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
