import { App, MarkdownView, Plugin, PluginSettingTab, Setting, TFile, MarkdownPostProcessorContext } from 'obsidian';

interface MagicLinkSettings {
    enabled: boolean;
    hoverDelayMs: number;
    minWordLength: number;
    maxResults: number;
    maxPhraseWords: number;
    detectNotes: boolean;
    detectHeadings: boolean;
    detectTags: boolean;
    detectProperties: boolean;
    excludedWords: string;
    showInsertButtons: boolean;
    // Custom Styles
    noteColor: string;
    noteBold: boolean;
    noteItalic: boolean;
    headingColor: string;
    headingBold: boolean;
    headingItalic: boolean;
    tagColor: string;
    tagBold: boolean;
    tagItalic: boolean;
    propertyColor: string;
    propertyBold: boolean;
    propertyItalic: boolean;
}

const DEFAULT_SETTINGS: MagicLinkSettings = {
    enabled: true,
    hoverDelayMs: 250,
    minWordLength: 2,
    maxResults: 10,
    maxPhraseWords: 5,
    detectNotes: true,
    detectHeadings: true,
    detectTags: true,
    detectProperties: true,
    excludedWords: 'the, and, for, with, this, that, from, have, been',
    showInsertButtons: true,
    // Default styles (empty means use CSS default)
    noteColor: '',
    noteBold: false,
    noteItalic: false,
    headingColor: '',
    headingBold: false,
    headingItalic: false,
    tagColor: '',
    tagBold: false,
    tagItalic: false,
    propertyColor: '',
    propertyBold: false,
    propertyItalic: false,
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
    lastHoverLine: number = -1;
    isPopoverLocked: boolean = false;
    isTyping: boolean = false;
    headerButtons: Map<MarkdownView, HTMLElement> = new Map();

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

        this.app.workspace.onLayoutReady(() => {
            this.addHeaderButtons();
            this.registerEvent(this.app.workspace.on('layout-change', () => this.addHeaderButtons()));
        });
    }

    addHeaderButtons() {
        this.app.workspace.iterateAllLeaves(leaf => {
            if (leaf.view instanceof MarkdownView) {
                const view = leaf.view;
                if (!this.headerButtons.has(view)) {
                    const btn = view.addAction('wand', 'Toggle MagicLink', () => {
                        this.settings.enabled = !this.settings.enabled;
                        this.saveSettings();
                        this.updateHeaderButtons();
                        // Refresh current view to update highlights
                        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                        if (activeView) {
                            // @ts-ignore
                            activeView.previewMode?.rerender(true);
                        }
                    });
                    this.headerButtons.set(view, btn);
                    this.updateButtonState(btn);
                }
            }
        });
    }

    updateHeaderButtons() {
        this.headerButtons.forEach(btn => this.updateButtonState(btn));
    }

    updateButtonState(btn: HTMLElement) {
        if (this.settings.enabled) {
            btn.style.opacity = '1';
            btn.style.color = 'var(--interactive-accent)';
        } else {
            btn.style.opacity = '0.4';
            btn.style.color = 'var(--text-muted)';
        }
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

    getMatchType(phrase: string): 'note' | 'heading' | 'tag' | 'property' | null {
        if (this.isExcluded(phrase)) return null;
        const key = phrase.toLowerCase();
        if (this.settings.detectNotes && this.noteIndex.hasMatch(phrase)) return 'note';
        if (this.settings.detectHeadings && this.headingIndex.has(key)) return 'heading';
        if (this.settings.detectTags && this.tagIndex.has(key)) return 'tag';
        if (this.settings.detectProperties && this.propertyIndex.has(key)) return 'property';
        return null;
    }

    hasAnyMatch(phrase: string): boolean {
        return this.getMatchType(phrase) !== null;
    }

    findAllMatches(text: string): { phrase: string, type: string, start: number, end: number }[] {
        const wordRegex = /\w+/g;
        const words: { text: string, start: number, end: number }[] = [];
        let match;
        while ((match = wordRegex.exec(text)) !== null) {
            words.push({ text: match[0], start: match.index, end: wordRegex.lastIndex });
        }

        const matches: { phrase: string, type: string, start: number, end: number }[] = [];

        for (let i = 0; i < words.length; i++) {
            for (let len = this.settings.maxPhraseWords; len >= 1; len--) {
                if (i + len > words.length) continue;

                const phraseWords = words.slice(i, i + len);
                const start = phraseWords[0].start;
                const end = phraseWords[phraseWords.length - 1].end;
                const phrase = text.slice(start, end);

                if (phrase.length >= this.settings.minWordLength) {
                    const type = this.getMatchType(phrase);
                    if (type) {
                        matches.push({ phrase, type, start, end });
                    }
                }
            }
        }
        return matches;
    }

    postProcessor(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
        if (!this.settings.enabled) return;

        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const textNodes: Text[] = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

        for (const textNode of textNodes) {
            const parent = textNode.parentElement;
            if (!parent || parent.closest('a') || parent.closest('code') || parent.closest('pre') || parent.classList.contains('magiclink-word')) continue;

            const text = textNode.textContent || '';
            const matches = this.findAllMatches(text);

            if (matches.length === 0) continue;

            // Filter overlaps - prioritize longer matches
            const sortedMatches = matches.sort((a, b) => (b.end - b.start) - (a.end - a.start));
            const acceptedMatches: typeof matches = [];
            const occupied = new Array(text.length).fill(false);

            for (const match of sortedMatches) {
                let isOccupied = false;
                for (let i = match.start; i < match.end; i++) {
                    if (occupied[i]) { isOccupied = true; break; }
                }
                if (!isOccupied) {
                    acceptedMatches.push(match);
                    for (let i = match.start; i < match.end; i++) occupied[i] = true;
                }
            }

            if (acceptedMatches.length === 0) continue;

            // Sort by start position for reconstruction
            acceptedMatches.sort((a, b) => a.start - b.start);

            const fragment = document.createDocumentFragment();
            let currentIndex = 0;

            for (const match of acceptedMatches) {
                if (match.start > currentIndex) {
                    fragment.appendChild(document.createTextNode(text.slice(currentIndex, match.start)));
                }

                const span = document.createElement('span');
                span.className = `magiclink-word magiclink-${match.type}`;
                span.textContent = text.slice(match.start, match.end);
                this.applyCustomStyles(span, match.type);
                fragment.appendChild(span);

                currentIndex = match.end;
            }

            if (currentIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.slice(currentIndex)));
            }

            textNode.parentNode?.replaceChild(fragment, textNode);
        }
    }

    applyCustomStyles(el: HTMLElement, type: string) {
        let color = '', bold = false, italic = false;

        switch (type) {
            case 'note':
                color = this.settings.noteColor;
                bold = this.settings.noteBold;
                italic = this.settings.noteItalic;
                break;
            case 'heading':
                color = this.settings.headingColor;
                bold = this.settings.headingBold;
                italic = this.settings.headingItalic;
                break;
            case 'tag':
                color = this.settings.tagColor;
                bold = this.settings.tagBold;
                italic = this.settings.tagItalic;
                break;
            case 'property':
                color = this.settings.propertyColor;
                bold = this.settings.propertyBold;
                italic = this.settings.propertyItalic;
                break;
        }

        if (color) el.style.color = color;
        if (bold) el.style.fontWeight = 'bold';
        if (italic) el.style.fontStyle = 'italic';
    }

    escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    onMouseMove(e: MouseEvent) {
        if (!this.settings.enabled || this.isTyping || this.isPopoverLocked) return;

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

        let wordStart = offset, wordEnd = offset;
        while (wordStart > 0 && /\w/.test(text[wordStart - 1])) wordStart--;
        while (wordEnd < text.length && /\w/.test(text[wordEnd])) wordEnd++;

        if (wordStart === wordEnd) return null;

        const contextStart = Math.max(0, wordStart - 100);
        const contextEnd = Math.min(text.length, wordEnd + 100);
        const context = text.slice(contextStart, contextEnd);

        const relativeOffset = wordStart - contextStart;
        const words: { word: string, start: number, end: number }[] = [];
        let match;
        const wordRegex = /\w+/g;
        while ((match = wordRegex.exec(context)) !== null) {
            words.push({ word: match[0], start: match.index, end: match.index + match[0].length });
        }

        let cursorWordIndex = -1;
        for (let i = 0; i < words.length; i++) {
            if (words[i].start <= relativeOffset && words[i].end >= relativeOffset) {
                cursorWordIndex = i;
                break;
            }
        }

        if (cursorWordIndex === -1) return null;

        for (let len = this.settings.maxPhraseWords; len >= 1; len--) {
            for (let startOffset = 0; startOffset < len; startOffset++) {
                const startIdx = cursorWordIndex - startOffset;
                const endIdx = startIdx + len;

                if (startIdx < 0 || endIdx > words.length) continue;

                const phraseWords = words.slice(startIdx, endIdx);
                const start = phraseWords[0].start;
                const end = phraseWords[phraseWords.length - 1].end;
                const phrase = context.slice(start, end);

                if (this.hasAnyMatch(phrase)) {
                    return { phrase };
                }
            }
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

        const header = this.popoverEl.createEl('div', { cls: 'magiclink-header' });
        header.createEl('strong', { text: phrase });
        if (phrase.includes(' ')) {
            header.createEl('span', { cls: 'magiclink-phrase-badge', text: `${phrase.split(' ').length} words` });
        }

        if (currentFileHeading) {
            this.createResultRow(this.popoverEl, `📍 Here → #${phrase}`,
                () => { if (activeFile) this.app.workspace.openLinkText(`#${phrase}`, activeFile.path); },
                `[[#${phrase}]]`
            );
        }

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

        const lineCount = editor.lineCount();
        for (let lineNum = 0; lineNum < lineCount; lineNum++) {
            const lineText = editor.getLine(lineNum);
            let match;
            phraseRegex.lastIndex = 0;

            while ((match = phraseRegex.exec(lineText)) !== null) {
                const from = { line: lineNum, ch: match.index };
                const to = { line: lineNum, ch: match.index + match[0].length };
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
    async buildIndex() { this.index.clear(); this.app.vault.getMarkdownFiles().forEach(f => this.addFile(f)); }
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

        new Setting(containerEl)
            .setName('Enable MagicLink')
            .setDesc('Toggle the entire plugin functionality on or off.')
            .addToggle(t => t.setValue(this.plugin.settings.enabled).onChange(async v => {
                this.plugin.settings.enabled = v;
                await this.plugin.saveSettings();
                this.plugin.updateHeaderButtons();
                // Refresh current view
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView) {
                    // @ts-ignore
                    activeView.previewMode?.rerender(true);
                }
            }));

        containerEl.createEl('h2', { text: 'Detection' });
        new Setting(containerEl).setName('Detect Notes').addToggle(t => t.setValue(this.plugin.settings.detectNotes).onChange(async v => { this.plugin.settings.detectNotes = v; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Detect Headings').addToggle(t => t.setValue(this.plugin.settings.detectHeadings).onChange(async v => { this.plugin.settings.detectHeadings = v; await this.plugin.saveSettings(); await this.plugin.buildAllIndexes(); }));
        new Setting(containerEl).setName('Detect Tags').addToggle(t => t.setValue(this.plugin.settings.detectTags).onChange(async v => { this.plugin.settings.detectTags = v; await this.plugin.saveSettings(); await this.plugin.buildAllIndexes(); }));
        new Setting(containerEl).setName('Detect Properties').addToggle(t => t.setValue(this.plugin.settings.detectProperties).onChange(async v => { this.plugin.settings.detectProperties = v; await this.plugin.saveSettings(); await this.plugin.buildAllIndexes(); }));

        containerEl.createEl('h2', { text: 'Phrase Detection' });
        new Setting(containerEl).setName('Max phrase words').addSlider(s => s.setLimits(1, 10, 1).setValue(this.plugin.settings.maxPhraseWords).setDynamicTooltip().onChange(async v => { this.plugin.settings.maxPhraseWords = v; await this.plugin.saveSettings(); }));

        containerEl.createEl('h2', { text: 'Styles' });

        this.addStyleSetting(containerEl, 'Notes', 'note');
        this.addStyleSetting(containerEl, 'Headings', 'heading');
        this.addStyleSetting(containerEl, 'Tags', 'tag');
        this.addStyleSetting(containerEl, 'Properties', 'property');

        containerEl.createEl('h2', { text: 'Behavior' });
        new Setting(containerEl).setName('Hover delay (ms)').addText(t => t.setValue(String(this.plugin.settings.hoverDelayMs)).onChange(async v => { this.plugin.settings.hoverDelayMs = parseInt(v) || 250; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Min word length').addText(t => t.setValue(String(this.plugin.settings.minWordLength)).onChange(async v => { this.plugin.settings.minWordLength = parseInt(v) || 3; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Max results').addText(t => t.setValue(String(this.plugin.settings.maxResults)).onChange(async v => { this.plugin.settings.maxResults = parseInt(v) || 10; await this.plugin.saveSettings(); }));
        new Setting(containerEl).setName('Show insert buttons').addToggle(t => t.setValue(this.plugin.settings.showInsertButtons).onChange(async v => { this.plugin.settings.showInsertButtons = v; await this.plugin.saveSettings(); }));

        containerEl.createEl('h2', { text: 'Exclusions' });
        new Setting(containerEl).setName('Excluded words').addTextArea(t => t.setValue(this.plugin.settings.excludedWords).onChange(async v => { this.plugin.settings.excludedWords = v; this.plugin.updateExcludedWords(); await this.plugin.saveSettings(); }));
    }

    addStyleSetting(containerEl: HTMLElement, name: string, type: 'note' | 'heading' | 'tag' | 'property') {
        const setting = new Setting(containerEl)
            .setName(name)
            .setDesc(`Customize style for ${name.toLowerCase()}`);

        setting.addColorPicker(color => color
            .setValue((this.plugin.settings as any)[`${type}Color`] || '#000000')
            .onChange(async value => {
                (this.plugin.settings as any)[`${type}Color`] = value;
                await this.plugin.saveSettings();
            }));

        setting.addToggle(toggle => toggle
            .setTooltip('Bold')
            .setValue((this.plugin.settings as any)[`${type}Bold`])
            .onChange(async value => {
                (this.plugin.settings as any)[`${type}Bold`] = value;
                await this.plugin.saveSettings();
            }));

        setting.addToggle(toggle => toggle
            .setTooltip('Italic')
            .setValue((this.plugin.settings as any)[`${type}Italic`])
            .onChange(async value => {
                (this.plugin.settings as any)[`${type}Italic`] = value;
                await this.plugin.saveSettings();
            }));
    }
}
