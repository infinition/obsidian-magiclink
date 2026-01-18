import { App, MarkdownView, Plugin, PluginSettingTab, Setting, TFile, MarkdownPostProcessorContext } from 'obsidian';

interface MagicLinkSettings {
    hoverDelayMs: number;
    minWordLength: number;
    maxResults: number;
    maxPhraseWords: number; // NEW: max words in a phrase to detect
    detectNotes: boolean;
    detectHeadings: boolean;
    detectTags: boolean;
    detectProperties: boolean;
    excludedWords: string;
    showInsertButtons: boolean;
}

const DEFAULT_SETTINGS: MagicLinkSettings = {
    hoverDelayMs: 250,
    minWordLength: 3,
    maxResults: 10,
    maxPhraseWords: 5,
    detectNotes: true,
    detectHeadings: true,
    detectTags: true,
    detectProperties: true,
    excludedWords: 'the, and, for, with, this, that, from, have, been',
    showInsertButtons: true,
}

interface HeadingMatch { file: TFile; heading: string; line: number; }
interface TagMatch { file: TFile; tag: string; line: number; }
interface PropertyMatch { file: TFile; property: string; value: string; }

export default class MagicLinkPlugin extends Plugin {
    settings: MagicLinkSettings;
    noteIndex: NoteIndex;
    headingIndex: Map<string, HeadingMatch[]> = new Map();
    tagIndex: Map<string, TagMatch[]> = new Map();
    propertyIndex: Map<string, PropertyMatch[]> = new Map();
    excludedWordsSet: Set<string> = new Set();
    popoverEl: HTMLElement | null = null;
    hoverTimeout: number | null = null;
    highlightTimeout: number | null = null;
    lastPhrase: string = '';
    lastHoverLine: number = -1; // Track line where hover occurred
    isPopoverLocked: boolean = false;
    isTyping: boolean = false;


    async onload() {
        await this.loadSettings();
        this.updateExcludedWords();

        this.noteIndex = new NoteIndex(this.app);
        await this.noteIndex.buildIndex();
        await this.buildAllIndexes();

        this.registerEvent(this.app.vault.on('create', async (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                this.noteIndex.addFile(file);
                await this.indexFile(file);
            }
        }));
        this.registerEvent(this.app.vault.on('delete', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                this.noteIndex.removeFile(file);
                this.removeFileFromIndexes(file);
            }
        }));
        this.registerEvent(this.app.vault.on('rename', async (file, oldPath) => {
            if (file instanceof TFile && file.extension === 'md') {
                this.noteIndex.renameFile(file, oldPath);
                this.removeFileFromIndexes(file);
                await this.indexFile(file);
            }
        }));
        this.registerEvent(this.app.metadataCache.on('changed', async (file) => {
            if (file.extension === 'md') {
                this.removeFileFromIndexes(file);
                await this.indexFile(file);
            }
        }));

        this.addSettingTab(new MagicLinkSettingTab(this.app, this));
        this.registerMarkdownPostProcessor(this.postProcessor.bind(this));
        this.registerDomEvent(document, 'mousemove', this.onMouseMove.bind(this));
        this.registerDomEvent(document, 'click', (e) => {
            if (this.popoverEl && !this.popoverEl.contains(e.target as Node)) {
                this.hidePopover();
            }
        });

        this.registerEvent(this.app.workspace.on('editor-change', () => {
            this.isTyping = true;
            if (this.highlightTimeout) window.clearTimeout(this.highlightTimeout);
            this.highlightTimeout = window.setTimeout(() => { this.isTyping = false; }, 2000);
        }));
    }

    updateExcludedWords() {
        this.excludedWordsSet.clear();
        this.settings.excludedWords.split(',').map(w => w.trim().toLowerCase()).forEach(w => { if (w) this.excludedWordsSet.add(w); });
    }

    async buildAllIndexes() {
        this.headingIndex.clear();
        this.tagIndex.clear();
        this.propertyIndex.clear();
        for (const file of this.app.vault.getMarkdownFiles()) await this.indexFile(file);
    }

    async indexFile(file: TFile) {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache) return;

        if (this.settings.detectHeadings && cache.headings) {
            for (const h of cache.headings) {
                const key = h.heading.toLowerCase();
                if (!this.headingIndex.has(key)) this.headingIndex.set(key, []);
                this.headingIndex.get(key)!.push({ file, heading: h.heading, line: h.position.start.line });
            }
        }

        if (this.settings.detectTags && cache.tags) {
            for (const t of cache.tags) {
                const tagName = t.tag.replace(/^#/, '').toLowerCase();
                if (!this.tagIndex.has(tagName)) this.tagIndex.set(tagName, []);
                this.tagIndex.get(tagName)!.push({ file, tag: t.tag, line: t.position.start.line });
            }
        }

        if (this.settings.detectProperties && cache.frontmatter) {
            for (const [prop, value] of Object.entries(cache.frontmatter)) {
                if (prop === 'position') continue;
                const values = Array.isArray(value) ? value : [value];
                for (const v of values) {
                    if (typeof v === 'string' && v.length >= this.settings.minWordLength) {
                        const key = v.toLowerCase();
                        if (!this.propertyIndex.has(key)) this.propertyIndex.set(key, []);
                        this.propertyIndex.get(key)!.push({ file, property: prop, value: v });
                    }
                }
            }
        }
    }

    removeFileFromIndexes(file: TFile) {
        for (const [key, matches] of this.headingIndex.entries()) {
            const filtered = matches.filter(m => m.file.path !== file.path);
            if (filtered.length === 0) this.headingIndex.delete(key); else this.headingIndex.set(key, filtered);
        }
        for (const [key, matches] of this.tagIndex.entries()) {
            const filtered = matches.filter(m => m.file.path !== file.path);
            if (filtered.length === 0) this.tagIndex.delete(key); else this.tagIndex.set(key, filtered);
        }
        for (const [key, matches] of this.propertyIndex.entries()) {
            const filtered = matches.filter(m => m.file.path !== file.path);
            if (filtered.length === 0) this.propertyIndex.delete(key); else this.propertyIndex.set(key, filtered);
        }
    }

    onunload() { this.hidePopover(); }

    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }

    isExcluded(word: string): boolean { return this.excludedWordsSet.has(word.toLowerCase()); }

    hasAnyMatch(phrase: string): boolean {
        if (phrase.split(/\s+/).length === 1 && this.isExcluded(phrase)) return false;
        const key = phrase.toLowerCase();
        return (this.settings.detectNotes && this.noteIndex.hasMatch(phrase)) ||
            (this.settings.detectHeadings && this.headingIndex.has(key)) ||
            (this.settings.detectTags && this.tagIndex.has(key)) ||
            (this.settings.detectProperties && this.propertyIndex.has(key));
    }

    postProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const textNodes: Text[] = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

        for (const textNode of textNodes) {
            const parent = textNode.parentElement;
            if (!parent || parent.closest('a') || parent.closest('code') || parent.closest('pre')) continue;

            const text = textNode.textContent || '';

            // Find all matching phrases (single and multi-word)
            const matches = this.findAllMatchingPhrases(text);
            if (matches.length === 0) continue;

            let html = text;
            // Sort by length descending to replace longer phrases first
            matches.sort((a, b) => b.phrase.length - a.phrase.length);

            for (const match of matches) {
                const regex = new RegExp(`\\b(${this.escapeRegex(match.phrase)})\\b`, 'gi');
                html = html.replace(regex, '<span class="magiclink-word">$1</span>');
            }

            if (html !== text) {
                const span = document.createElement('span');
                span.innerHTML = html;
                textNode.parentNode?.replaceChild(span, textNode);
            }
        }
    }

    escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    findAllMatchingPhrases(text: string): { phrase: string, start: number, end: number }[] {
        const words = text.split(/\b/).filter(w => /\w/.test(w));
        const matches: { phrase: string, start: number, end: number }[] = [];
        const foundPhrases = new Set<string>();

        // Check all possible phrase combinations
        for (let i = 0; i < words.length; i++) {
            for (let len = this.settings.maxPhraseWords; len >= 1; len--) {
                if (i + len > words.length) continue;

                const phraseWords = words.slice(i, i + len);
                const phrase = phraseWords.join(' ');

                if (phrase.length >= this.settings.minWordLength &&
                    !foundPhrases.has(phrase.toLowerCase()) &&
                    this.hasAnyMatch(phrase)) {
                    foundPhrases.add(phrase.toLowerCase());
                    matches.push({ phrase, start: 0, end: 0 });
                }
            }
        }

        return matches;
    }

    onMouseMove(e: MouseEvent) {
        if (this.isTyping || this.isPopoverLocked) return;

        const target = e.target as HTMLElement;
        if (this.popoverEl && this.popoverEl.contains(target)) { this.isPopoverLocked = true; return; }
        if (!target.closest('.cm-content') && !target.closest('.markdown-preview-view')) return;

        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (!range) return;

        const result = this.getPhraseAtRange(range);
        if (!result) return;

        if (result.phrase === this.lastPhrase && this.popoverEl) return;

        if (this.hoverTimeout) window.clearTimeout(this.hoverTimeout);
        this.hoverTimeout = window.setTimeout(() => {
            this.lastPhrase = result.phrase;
            this.showPopover(result.phrase, e.clientX, e.clientY);
        }, this.settings.hoverDelayMs);
    }

    getPhraseAtRange(range: Range): { phrase: string } | null {
        const node = range.startContainer;
        if (node.nodeType !== Node.TEXT_NODE) return null;

        const text = node.textContent || '';
        const offset = range.startOffset;

        // Get word boundaries
        let wordStart = offset, wordEnd = offset;
        while (wordStart > 0 && /\w/.test(text[wordStart - 1])) wordStart--;
        while (wordEnd < text.length && /\w/.test(text[wordEnd])) wordEnd++;

        if (wordStart === wordEnd) return null;

        // Try to find multi-word phrases around the cursor position
        // Extract surrounding context
        const contextStart = Math.max(0, wordStart - 100);
        const contextEnd = Math.min(text.length, wordEnd + 100);
        const context = text.slice(contextStart, contextEnd);

        // Find word positions in context
        const relativeOffset = wordStart - contextStart;
        const words: { word: string, start: number, end: number }[] = [];
        let match;
        const wordRegex = /\w+/g;
        while ((match = wordRegex.exec(context)) !== null) {
            words.push({ word: match[0], start: match.index, end: match.index + match[0].length });
        }

        // Find which word the cursor is on
        let cursorWordIndex = -1;
        for (let i = 0; i < words.length; i++) {
            if (words[i].start <= relativeOffset && words[i].end >= relativeOffset) {
                cursorWordIndex = i;
                break;
            }
        }

        if (cursorWordIndex === -1) return null;

        // Try different phrase lengths, starting from longest
        for (let len = this.settings.maxPhraseWords; len >= 1; len--) {
            // Try different starting positions that include the cursor word
            for (let startOffset = 0; startOffset < len; startOffset++) {
                const startIdx = cursorWordIndex - startOffset;
                const endIdx = startIdx + len;

                if (startIdx < 0 || endIdx > words.length) continue;

                const phraseWords = words.slice(startIdx, endIdx).map(w => w.word);
                const phrase = phraseWords.join(' ');

                if (this.hasAnyMatch(phrase)) {
                    return { phrase };
                }
            }
        }

        // Fall back to single word
        const singleWord = text.slice(wordStart, wordEnd);
        if (singleWord.length >= this.settings.minWordLength && this.hasAnyMatch(singleWord)) {
            return { phrase: singleWord };
        }

        return null;
    }

    showPopover(phrase: string, x: number, y: number) {
        if (this.isPopoverLocked) return;
        this.hidePopover();

        const key = phrase.toLowerCase();
        const noteMatches = this.settings.detectNotes ? this.noteIndex.getFilesByName(phrase) : [];
        const headingMatches = this.settings.detectHeadings ? (this.headingIndex.get(key) || []) : [];
        const tagMatches = this.settings.detectTags ? (this.tagIndex.get(key) || []) : [];
        const propertyMatches = this.settings.detectProperties ? (this.propertyIndex.get(key) || []) : [];

        const activeFile = this.app.workspace.getActiveFile();
        let currentFileHeading = false;
        if (activeFile && this.settings.detectHeadings) {
            const cache = this.app.metadataCache.getFileCache(activeFile);
            currentFileHeading = cache?.headings?.some(h => h.heading.toLowerCase() === key) || false;
        }

        const otherHeadings = headingMatches.filter(h => !activeFile || h.file.path !== activeFile.path);
        const otherTags = tagMatches.filter(t => !activeFile || t.file.path !== activeFile.path);
        const otherProperties = propertyMatches.filter(p => !activeFile || p.file.path !== activeFile.path);

        if (noteMatches.length === 0 && otherHeadings.length === 0 && otherTags.length === 0 && otherProperties.length === 0 && !currentFileHeading) return;

        this.popoverEl = document.body.createEl('div', { cls: 'magiclink-popover' });

        let posX = x + 20, posY = y + 20;
        if (posX + 320 > window.innerWidth) posX = x - 320;
        if (posY + 320 > window.innerHeight) posY = y - 320;
        this.popoverEl.style.left = `${Math.max(10, posX)}px`;
        this.popoverEl.style.top = `${Math.max(10, posY)}px`;

        this.popoverEl.addEventListener('mouseenter', () => { this.isPopoverLocked = true; });
        this.popoverEl.addEventListener('mouseleave', () => {
            this.isPopoverLocked = false;
            setTimeout(() => { if (!this.isPopoverLocked) this.hidePopover(); }, 200);
        });

        // Header with phrase
        const header = this.popoverEl.createEl('div', { cls: 'magiclink-header' });
        header.createEl('strong', { text: phrase });
        if (phrase.includes(' ')) {
            header.createEl('span', { cls: 'magiclink-phrase-badge', text: `${phrase.split(' ').length} words` });
        }

        // Current file heading
        if (currentFileHeading) {
            this.createResultRow(this.popoverEl, `📍 Here → #${phrase}`,
                () => { if (activeFile) this.app.workspace.openLinkText(`#${phrase}`, activeFile.path); },
                `[[#${phrase}]]`
            );
        }

        // Notes section
        if (noteMatches.length > 0) {
            const section = this.popoverEl.createEl('div', { cls: 'magiclink-section' });
            section.createEl('div', { cls: 'magiclink-section-title', text: '📄 Notes' });

            noteMatches.slice(0, this.settings.maxResults).forEach(file => {
                this.createResultRow(section, file.basename,
                    () => this.app.workspace.getLeaf().openFile(file),
                    `[[${file.basename}]]`
                );
            });
        }

        // Headings section
        if (otherHeadings.length > 0) {
            const section = this.popoverEl.createEl('div', { cls: 'magiclink-section' });
            section.createEl('div', { cls: 'magiclink-section-title', text: '# Headings' });

            otherHeadings.slice(0, this.settings.maxResults).forEach(match => {
                this.createResultRow(section, `${match.file.basename} → #${match.heading}`,
                    () => this.app.workspace.openLinkText(`${match.file.path}#${match.heading}`, match.file.path),
                    `[[${match.file.basename}#${match.heading}]]`
                );
            });
        }

        // Tags section
        if (otherTags.length > 0) {
            const section = this.popoverEl.createEl('div', { cls: 'magiclink-section' });
            section.createEl('div', { cls: 'magiclink-section-title', text: '🏷️ Tags' });

            otherTags.slice(0, this.settings.maxResults).forEach(match => {
                this.createResultRow(section, `${match.file.basename} (line ${match.line + 1})`,
                    () => this.openFileAtLine(match.file, match.line),
                    match.tag
                );
            });
        }

        // Properties section
        if (otherProperties.length > 0) {
            const section = this.popoverEl.createEl('div', { cls: 'magiclink-section' });
            section.createEl('div', { cls: 'magiclink-section-title', text: '📋 Properties' });

            otherProperties.slice(0, this.settings.maxResults).forEach(match => {
                this.createResultRow(section, `${match.file.basename} (${match.property})`,
                    () => this.app.workspace.getLeaf().openFile(match.file),
                    `[[${match.file.basename}]]`
                );
            });
        }
    }

    createResultRow(container: HTMLElement, label: string, onClick: () => void, linkText: string) {
        const row = container.createEl('div', { cls: 'magiclink-row' });

        const btn = row.createEl('button', { cls: 'magiclink-btn' });
        btn.textContent = label;
        btn.onclick = (e) => { e.stopPropagation(); onClick(); this.hidePopover(); };

        if (this.settings.showInsertButtons) {
            const insertBtn = row.createEl('button', { cls: 'magiclink-insert-btn', attr: { title: `Insert ${linkText}` } });
            insertBtn.textContent = '🔗';
            insertBtn.onclick = (e) => {
                e.stopPropagation();
                this.insertLink(linkText);
                this.hidePopover();
            };
        }
    }

    openFileAtLine(file: TFile, line: number) {
        this.app.workspace.getLeaf().openFile(file).then(() => {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (view) {
                view.editor.setCursor({ line, ch: 0 });
                view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
            }
        });
    }

    insertLink(linkText: string) {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !this.lastPhrase) return;

        const editor = view.editor;
        const phraseToFind = this.lastPhrase;
        const escapedPhrase = this.escapeRegex(phraseToFind);
        const phraseRegex = new RegExp(`\\b${escapedPhrase}\\b`, 'gi');

        // Search all lines for the phrase
        const lineCount = editor.lineCount();
        for (let lineNum = 0; lineNum < lineCount; lineNum++) {
            const lineText = editor.getLine(lineNum);
            let match;
            phraseRegex.lastIndex = 0; // Reset regex

            while ((match = phraseRegex.exec(lineText)) !== null) {
                const from = { line: lineNum, ch: match.index };
                const to = { line: lineNum, ch: match.index + match[0].length };

                // Replace and return (only first occurrence)
                editor.replaceRange(linkText, from, to);
                return;
            }
        }
    }


    hidePopover() {
        if (this.popoverEl) { this.popoverEl.remove(); this.popoverEl = null; }
        if (this.hoverTimeout) { window.clearTimeout(this.hoverTimeout); this.hoverTimeout = null; }
        this.lastPhrase = '';
        this.isPopoverLocked = false;
    }
}

class NoteIndex {
    index: Map<string, TFile[]> = new Map();
    constructor(public app: App) { }

    async buildIndex() {
        this.index.clear();
        this.app.vault.getMarkdownFiles().forEach(f => this.addFile(f));
    }

    addFile(file: TFile) {
        const name = file.basename.toLowerCase();
        if (!this.index.has(name)) this.index.set(name, []);
        this.index.get(name)!.push(file);
    }

    removeFile(file: TFile) {
        const name = file.basename.toLowerCase();
        const files = this.index.get(name);
        if (files) {
            const filtered = files.filter(f => f.path !== file.path);
            if (filtered.length === 0) this.index.delete(name); else this.index.set(name, filtered);
        }
    }

    renameFile(file: TFile, oldPath: string) {
        const oldName = oldPath.split('/').pop()?.replace(/\.md$/, '')?.toLowerCase() || '';
        const oldFiles = this.index.get(oldName);
        if (oldFiles) {
            const filtered = oldFiles.filter(f => f.path !== file.path);
            if (filtered.length === 0) this.index.delete(oldName); else this.index.set(oldName, filtered);
        }
        this.addFile(file);
    }

    getFilesByName(name: string): TFile[] { return this.index.get(name.toLowerCase()) || []; }
    hasMatch(name: string): boolean { return this.index.has(name.toLowerCase()); }
}

class MagicLinkSettingTab extends PluginSettingTab {
    constructor(app: App, public plugin: MagicLinkPlugin) { super(app, plugin); }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h1', { text: 'MagicLink Settings' });

        containerEl.createEl('h2', { text: 'Detection' });

        new Setting(containerEl).setName('Detect Notes').setDesc('Match words/phrases with note names')
            .addToggle(t => t.setValue(this.plugin.settings.detectNotes).onChange(async v => { this.plugin.settings.detectNotes = v; await this.plugin.saveSettings(); }));

        new Setting(containerEl).setName('Detect Headings').setDesc('Match words/phrases with headings')
            .addToggle(t => t.setValue(this.plugin.settings.detectHeadings).onChange(async v => { this.plugin.settings.detectHeadings = v; await this.plugin.saveSettings(); await this.plugin.buildAllIndexes(); }));

        new Setting(containerEl).setName('Detect Tags').setDesc('Match words with tags (without #)')
            .addToggle(t => t.setValue(this.plugin.settings.detectTags).onChange(async v => { this.plugin.settings.detectTags = v; await this.plugin.saveSettings(); await this.plugin.buildAllIndexes(); }));

        new Setting(containerEl).setName('Detect Properties').setDesc('Match words with frontmatter values')
            .addToggle(t => t.setValue(this.plugin.settings.detectProperties).onChange(async v => { this.plugin.settings.detectProperties = v; await this.plugin.saveSettings(); await this.plugin.buildAllIndexes(); }));

        containerEl.createEl('h2', { text: 'Phrase Detection' });

        new Setting(containerEl).setName('Max phrase words').setDesc('Maximum number of consecutive words to detect as a phrase (e.g., "Machine Learning Basics" = 3 words)')
            .addSlider(s => s.setLimits(1, 10, 1).setValue(this.plugin.settings.maxPhraseWords).setDynamicTooltip()
                .onChange(async v => { this.plugin.settings.maxPhraseWords = v; await this.plugin.saveSettings(); }));

        containerEl.createEl('h2', { text: 'Behavior' });

        new Setting(containerEl).setName('Hover delay (ms)').setDesc('Delay before popup appears')
            .addText(t => t.setValue(String(this.plugin.settings.hoverDelayMs)).onChange(async v => { this.plugin.settings.hoverDelayMs = parseInt(v) || 250; await this.plugin.saveSettings(); }));

        new Setting(containerEl).setName('Min word length').setDesc('Minimum characters for single word detection')
            .addText(t => t.setValue(String(this.plugin.settings.minWordLength)).onChange(async v => { this.plugin.settings.minWordLength = parseInt(v) || 3; await this.plugin.saveSettings(); }));

        new Setting(containerEl).setName('Max results').setDesc('Max items per section')
            .addText(t => t.setValue(String(this.plugin.settings.maxResults)).onChange(async v => { this.plugin.settings.maxResults = parseInt(v) || 10; await this.plugin.saveSettings(); }));

        new Setting(containerEl).setName('Show insert buttons').setDesc('Show 🔗 button to insert links')
            .addToggle(t => t.setValue(this.plugin.settings.showInsertButtons).onChange(async v => { this.plugin.settings.showInsertButtons = v; await this.plugin.saveSettings(); }));

        containerEl.createEl('h2', { text: 'Exclusions' });

        new Setting(containerEl).setName('Excluded words').setDesc('Comma-separated list of words to ignore')
            .addTextArea(t => t.setValue(this.plugin.settings.excludedWords).onChange(async v => { this.plugin.settings.excludedWords = v; this.plugin.updateExcludedWords(); await this.plugin.saveSettings(); }));
    }
}
