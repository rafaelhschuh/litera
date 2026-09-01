# ADR-0008: Prepared PDF text, figures and native glyphs

Status: Accepted

## Context

Opening adapted PDFs downloaded the original in the browser and repeated extraction and canvas rendering on every uncached page. Clipping paths were misclassified as figures, duplicating complete pages. Some digital PDFs omit Unicode mappings for contextual glyphs even though the embedded font draws them correctly.

## Decision

Discovery prepares all pages using one PDF.js document. Derived page JSON, isolated graphics and necessary sanitized font subsets live under the data directory, keyed by preparation version, source path, size and modification time. Atomic page writes make interrupted scans restartable; a completion marker avoids repeat work. Source books remain untouched. Existing catalogued PDFs prepare in the background on startup, with individual missing pages available through a compatibility preparation path.

The adapted reader requests prepared JSON and assets only. PDF.js and the original document are loaded in the browser only for original viewing or document search. Asset access uses the same book authorization and source identity as content access.

Only actual paint operators produce figures. A constructPath ending with endPath is clipping, not a drawing. Figure exports suppress text painting. Missing Unicode mappings use the embedded glyph in a dedicated inline font span, preserving visual fidelity and reflow without guessing letters or running OCR. Such glyphs retain a semantic limitation for copying, search and assistive technology; visual correctness cannot reconstruct absent Unicode information.

## Alternatives and consequences

Rendering whole pages on demand was rejected because it duplicates text and adds latency. Blind character substitutions can corrupt legitimate Greek letters or numbers. OCR is unnecessary for the native-text collection and cannot provide exact fidelity guarantees.

Preparation adds discovery time and derived disk usage. Cache identity follows the scanner's size/mtime convention; a preparation-version change rebuilds output. Old derived directories are retained and may be removed while the server is stopped; source data is never affected. The original-document path remains available during a preparation failure.
