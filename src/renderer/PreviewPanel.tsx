import type { SyncPreview } from '../shared/jobs';

interface Props {
  preview: SyncPreview;
  onClose(): void;
}

function SampleList({ title, paths }: { title: string; paths: string[] }) {
  if (paths.length === 0) return null;
  return (
    <details>
      <summary>{title} — showing up to {paths.length}</summary>
      <ul>{paths.map((path) => <li key={path}><code>{path}</code></li>)}</ul>
    </details>
  );
}

export default function PreviewPanel({ preview, onClose }: Props) {
  return (
    <section className="preview-panel" aria-label="Read-only sync preview" aria-live="polite">
      <div className="preview-heading">
        <div>
          <span className="eyebrow">READ-ONLY ANALYSIS</span>
          <h3>Preview results</h3>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <p className="form-note">
        Nothing was copied, changed, or deleted. This preview compares relative names, sizes, and
        modification times; it does not read file contents.
      </p>
      <div className="preview-stats">
        <div><strong>{preview.sourceFileCount}</strong><span>included source files</span></div>
        <div><strong>{preview.wouldCopy}</strong><span>new files</span></div>
        <div><strong>{preview.wouldUpdate}</strong><span>changed files</span></div>
        <div className={preview.deletionGuardTriggered ? 'danger-stat' : ''}>
          <strong>{preview.wouldDelete}</strong>
          <span>possible destination deletions ({preview.deletionPercentage.toFixed(1)}%)</span>
        </div>
      </div>
      {preview.deletionGuardTriggered && (
        <p className="error" role="alert">
          Warning: this preview shows a large number of destination-only files. A manual /MIR run can delete them.
        </p>
      )}
      {preview.warnings.map((warning) => <p className="warning-note" key={warning}>{warning}</p>)}
      <div className="preview-samples">
        <SampleList title="New files" paths={preview.sampleCopies} />
        <SampleList title="Changed files" paths={preview.sampleUpdates} />
        <SampleList title="Potential deletions" paths={preview.sampleDeletions} />
      </div>
    </section>
  );
}
