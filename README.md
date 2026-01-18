# MagicLink for Obsidian

[![Release](https://img.shields.io/github/v/release/infinition/obsidian-magiclink?style=for-the-badge)](https://github.com/infinition/obsidian-magiclink/releases/latest)
[![License](https://img.shields.io/github/license/infinition/obsidian-magiclink?style=for-the-badge)](LICENSE)

**MagicLink** is a powerful hover-first navigation plugin for Obsidian. It automatically detects words and multi-word phrases in your notes that match note names, headings, tags, or property values, and displays an interactive popup with quick navigation and link insertion options.

## ✨ Features

### 🔍 Smart Detection
MagicLink detects words and phrases that match:
- **📄 Notes** - Words/phrases matching note file names
- **# Headings** - Words/phrases matching headings in any note
- **🏷️ Tags** - Words matching tags (without the # prefix)
- **📋 Properties** - Words matching frontmatter property values

### 📝 Multi-Word Phrase Detection
MagicLink can detect phrases of up to 10 consecutive words. For example:
- A note named "Machine Learning Basics" will be detected when you hover over those 3 words
- The plugin prioritizes the longest matching phrase
- Configurable via slider in settings (1-10 words)

### 🎯 Interactive Popup
When you hover over a matching word or phrase, a popup appears with:
- **Navigation links** - Click to open notes, jump to headings, or navigate to tags
- **🔗 Insert buttons** - Small button next to each result to insert the appropriate link
  - `[[NoteName]]` for notes
  - `[[NoteName#Heading]]` for headings
  - `#tag` for tags
  - `[[NoteName]]` for properties

### 🎨 Visual Highlighting
Matching words and phrases are visually highlighted in reading mode with a dotted underline, styled like internal links.

### ⚙️ Highly Configurable

#### Detection Toggles
Toggle each detection type independently:
- ✅ Detect Notes
- ✅ Detect Headings
- ✅ Detect Tags
- ✅ Detect Properties

#### Phrase Detection
- **Max phrase words** (slider 1-10) - Maximum consecutive words to detect as a phrase

#### Behavior
- **Hover delay** - Time before popup appears (default: 250ms)
- **Min word length** - Minimum characters for single word detection (default: 3)
- **Max results** - Maximum items shown per section (default: 10)
- **Show insert buttons** - Toggle 🔗 buttons on/off

### 🚫 Word Exclusions
Add common words to an exclusion list so they won't trigger the popup.

### ⏱️ Smart Behavior
- **No popup while typing** - Prevents distractions during writing
- **Popup stays visible** - The popup locks in place when your mouse enters it
- **No interference** - Another word underneath won't replace the current popup

---

## 📦 Installation

### Method 1: BRAT (Recommended for Beta Testing)

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins
2. Open BRAT settings
3. Click **"Add Beta Plugin"**
4. Enter: `infinition/obsidian-magiclink`
5. Click **"Add Plugin"**
6. Enable MagicLink in Community Plugins

### Method 2: Manual Installation

1. Go to [Releases](https://github.com/infinition/obsidian-magiclink/releases/latest)
2. Download `main.js`, `manifest.json`, and `styles.css`
3. Create folder: `<your-vault>/.obsidian/plugins/obsidian-magiclink/`
4. Copy the 3 files into this folder
5. Reload Obsidian
6. Enable MagicLink in Settings → Community Plugins

### Method 3: Build from Source

```bash
# Clone the repository
git clone https://github.com/infinition/obsidian-magiclink.git

# Navigate to plugin folder
cd obsidian-magiclink

# Install dependencies
npm install

# Build the plugin
npm run build

# Copy main.js, manifest.json, styles.css to your vault's plugin folder
```

---

## ⚙️ Settings

### Detection
| Setting | Description | Default |
|---------|-------------|---------|
| Detect Notes | Match words/phrases with note names | ✅ On |
| Detect Headings | Match words/phrases with headings | ✅ On |
| Detect Tags | Match words with tags (without #) | ✅ On |
| Detect Properties | Match words with frontmatter values | ✅ On |

### Phrase Detection
| Setting | Description | Default |
|---------|-------------|---------|
| Max phrase words | Max consecutive words to detect (1-10) | 5 |

### Behavior
| Setting | Description | Default |
|---------|-------------|---------|
| Hover delay (ms) | Time before popup appears | 250 |
| Min word length | Minimum characters for detection | 3 |
| Max results | Max items per section | 10 |
| Show insert buttons | Show 🔗 button for link insertion | ✅ On |

### Exclusions
| Setting | Description | Default |
|---------|-------------|---------|
| Excluded words | Comma-separated list of ignored words | the, and, for, with, this, that, from, have, been |

---

## 🖱️ Usage

1. **Hover** over any word or phrase in your note
2. If it matches a note, heading, tag, or property, a **popup** appears
3. **Click** on any item to navigate to that location
4. Or click the **🔗 button** to insert the appropriate link

## 📝 Popup Sections

| Icon | Section | Action |
|------|---------|--------|
| 📍 | Here | Jump to heading in current note |
| 📄 | Notes | Open notes with matching names |
| # | Headings | Jump to headings in other notes |
| 🏷️ | Tags | Jump to where a tag is used (with line number) |
| 📋 | Properties | Open notes with matching property values |

## 🔗 Link Insertion

Each result row has a small 🔗 button that inserts the appropriate link:

| Type | Inserted Link |
|------|---------------|
| Note | `[[NoteName]]` |
| Heading | `[[NoteName#Heading]]` |
| Tag | `#tagname` |
| Property | `[[NoteName]]` |

---

## 🔧 Technical Details

- **DOM-based detection** - No CodeMirror conflicts
- **Efficient indexing** - Indexes built on load, updated on file changes
- **Multi-word support** - Detects phrases up to 10 words
- **Smart popup** - Locks when mouse enters, prevents accidental replacement

---

## 📄 License

[MIT License](LICENSE) - Free to use and modify.

## 👤 Author

**[Infinition](https://github.com/infinition)**

## 🔗 Links

- [GitHub Repository](https://github.com/infinition/obsidian-magiclink)
- [Report Issues](https://github.com/infinition/obsidian-magiclink/issues)
- [Releases](https://github.com/infinition/obsidian-magiclink/releases)

---

Made with ❤️ for the Obsidian community.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=infinition/obsidian-magiclink&type=date&legend=top-left)](https://www.star-history.com/#infinition/obsidian-magiclink&type=date&legend=top-left)

