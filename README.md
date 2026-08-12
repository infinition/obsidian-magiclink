<img width="384" height="384" alt="image-removebg-preview (12)" src="https://github.com/user-attachments/assets/a6e9610c-7b92-4713-99f1-e2707f596ec8" />

# MagicLink for Obsidian

[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) ![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white) [![Release](https://img.shields.io/github/v/release/infinition/obsidian-magiclink?style=flat)](https://github.com/infinition/obsidian-magiclink/releases) [![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-7C3AED?style=flat&logo=obsidian&logoColor=white)](https://obsidian.md/plugins?id=magiclink) [![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/infinition)

<img width="1079" height="827" alt="MagicLink interface" src="https://github.com/user-attachments/assets/8102ff58-e5f4-44c8-8853-8999c1a45991" />

A hover-first navigation plugin for Obsidian. MagicLink scans your notes for words and phrases that match note names, headings, tags, or property values, and shows a popup with quick navigation and link insertion options when you hover over them.

Works in both Edit and Read mode. Toggle it on/off from a button near the View/Edit switch.

---

## Features

- Detects matches for: note names, headings, tags, frontmatter property values.
- Multi-word phrase detection (up to 10 words).
- Hover popup with: open note, insert `[[wikilink]]`, insert heading link, insert tag.
- Link highlights visible in Read mode.
- DOM-based detection with no CodeMirror conflicts.
- Index built on load and updated on file changes.
- Popup locks when mouse enters it to prevent accidental dismissal.

---

## Link types inserted

| Match type | Inserted link |
|------------|--------------|
| Note | `[[NoteName]]` |
| Heading | `[[NoteName#Heading]]` |
| Tag | `#tagname` |
| Property | `[[NoteName]]` |

---

## Installation

Search for **MagicLink** in Obsidian's Community Plugins browser.

---

## Star History

<a href="https://www.star-history.com/?repos=infinition%2Fobsidian-magiclink&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=infinition/obsidian-magiclink&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=infinition/obsidian-magiclink&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=infinition/obsidian-magiclink&type=date&legend=top-left" />
 </picture>
</a>

---

## License

MIT. See [LICENSE](LICENSE).
