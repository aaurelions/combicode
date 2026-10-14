//! Built-in instructions placed at the top of the document.

use clap::ValueEnum;

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Preset {
    /// For source code: understand the project and cite files and lines.
    Code,
    /// For documentation: answer strictly from the packed documents.
    Docs,
}

/// Which parts of the document exist, so the prompt describes only those.
pub struct Layout {
    pub map: bool,
    pub outline: bool,
    pub code: bool,
    pub sizes: bool,
    /// Some files are listed without content.
    pub omitted: bool,
}

pub fn builtin(preset: Preset, project: &str, layout: &Layout) -> String {
    let mut paragraphs = Vec::new();
    paragraphs.push(match preset {
        Preset::Code => format!(
            "You are given the source code of the project \"{project}\", packed into a single document by Combicode."
        ),
        Preset::Docs => format!(
            "You are given the documentation of the project \"{project}\", packed into a single document by Combicode. Treat it as the authoritative reference: base your answers and code only on the APIs, options and behavior it describes, and do not suggest anything it does not mention."
        ),
    });

    let mut structure = Vec::new();
    if layout.map {
        let mut fields = vec!["OL (line range in the original file)"];
        if layout.code {
            fields.push("ML (line range in this document)");
        }
        if layout.sizes {
            fields.push("size");
        }
        let symbols = if layout.outline {
            ", with the classes, functions and other symbols found in each file"
        } else {
            ""
        };
        structure.push(format!(
            "<code_map> lists every included file as a directory tree{symbols}. Entries show {}.",
            join_words(&fields)
        ));
    }
    if layout.code {
        let order = if layout.map { " in map order" } else { "" };
        let omitted = if layout.omitted {
            " Files marked omitted=\"true\" are listed without their content."
        } else {
            ""
        };
        structure.push(format!(
            "<code> contains the files{order}, each inside a <file path=\"...\"> element exactly as it appears on disk.{omitted}"
        ));
    }
    paragraphs.push(structure.join(" "));

    paragraphs.push(match (preset, layout.code) {
        (Preset::Code, true) => {
            let lookup = if layout.map {
                " Use ML ranges to find a file or symbol in this document."
            } else {
                ""
            };
            format!(
                "Before answering, study the project as a whole: its structure, entry points, configuration, dependencies and how the parts interact. When you refer to code, cite the file path and original line numbers.{lookup}"
            )
        }
        (Preset::Code, false) => {
            "File contents are not included. Use the map to understand the project's structure and to decide which files are relevant.".to_string()
        }
        (Preset::Docs, _) => {
            "When you answer, cite the file that supports each statement.".to_string()
        }
    });
    paragraphs.join("\n\n") + "\n"
}

fn join_words(words: &[&str]) -> String {
    match words {
        [] => String::new(),
        [one] => (*one).to_string(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}
