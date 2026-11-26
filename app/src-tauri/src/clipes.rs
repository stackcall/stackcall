use serde::Serialize;
use std::{
    cmp::Reverse,
    fs::{self, Metadata},
    io,
    os::windows::fs::MetadataExt,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::AppHandle;
use windows::{
    core::HSTRING,
    Win32::{
        Storage::{EnhancedStorage::PKEY_Media_Duration, FileSystem::FILE_ATTRIBUTE_REPARSE_POINT},
        System::Com::{
            CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
        },
        UI::Shell::{
            BHID_Transfer, FOLDERID_RecycleBinFolder, IShellItem, IShellItem2, ITransferSource,
            SHCreateItemFromParsingName, SHGetKnownFolderItem, KF_FLAG_DEFAULT, TSF_NORMAL,
        },
    },
};

#[derive(Serialize)]
pub struct Clip {
    nome: String,
    caminho: PathBuf,
    em: u64,
    duracao: Option<f64>,
    tamanho: u64,
}

fn invalid_path() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        "Escolha um arquivo MP4 diretamente na pasta Vídeos/Stackcall.",
    )
}

fn is_link(metadata: &Metadata) -> bool {
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
}

fn gallery_root(dir: &Path) -> io::Result<PathBuf> {
    let metadata = fs::symlink_metadata(dir)?;
    if !metadata.is_dir() || is_link(&metadata) {
        return Err(invalid_path());
    }
    let parent = dir.parent().ok_or_else(invalid_path)?.canonicalize()?;
    let root = dir.canonicalize()?;
    if root.parent() != Some(&parent)
        || !root
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("Stackcall"))
    {
        return Err(invalid_path());
    }
    Ok(root)
}

// The IPC accepts a single name, never a path, wildcard or NTFS stream.
fn clip_path(root: &Path, name: &str) -> io::Result<(PathBuf, Metadata)> {
    let name_path = Path::new(name);
    if name
        .chars()
        .any(|c| c.is_control() || r#"/\:*?"<>|"#.contains(c))
        || !name_path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("mp4"))
    {
        return Err(invalid_path());
    }
    let entry = root.join(name);
    let metadata = fs::symlink_metadata(&entry)?;
    if !metadata.is_file() || is_link(&metadata) {
        return Err(invalid_path());
    }
    let path = entry.canonicalize()?;
    if path.parent() != Some(root)
        || !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("mp4"))
    {
        return Err(invalid_path());
    }
    Ok((path, metadata))
}

struct ComApartment;

impl ComApartment {
    fn enter() -> windows::core::Result<Self> {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE).ok()? };
        Ok(Self)
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() }
    }
}

fn duration(path: &Path) -> Option<f64> {
    unsafe {
        let item: IShellItem2 =
            SHCreateItemFromParsingName(&HSTRING::from(path.as_os_str()), None).ok()?;
        let ticks = item.GetUInt64(&PKEY_Media_Duration).ok()?;
        Some(ticks as f64 / 10_000_000.0)
    }
}

fn list(dir: &Path) -> Result<Vec<Clip>, String> {
    let root = match gallery_root(dir) {
        Ok(root) => root,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    let _apartment = ComApartment::enter().map_err(|error| error.to_string())?;
    let mut clips = Vec::new();
    for entry in fs::read_dir(&root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Ok((path, metadata)) = clip_path(&root, name) else {
            continue;
        };
        let em = metadata
            .created()
            .or_else(|_| metadata.modified())
            .ok()
            .and_then(|date| date.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |date| date.as_millis() as u64);
        let caminho = dunce::simplified(&path);
        clips.push(Clip {
            nome: name.to_owned(),
            caminho: caminho.to_path_buf(),
            em,
            duracao: duration(caminho),
            tamanho: metadata.len(),
        });
    }
    clips.sort_by_key(|clip| Reverse(clip.em));
    Ok(clips)
}

fn recycle(path: &Path) -> windows::core::Result<()> {
    let _apartment = ComApartment::enter()?;
    let path = HSTRING::from(dunce::simplified(path).as_os_str());
    unsafe {
        let source: IShellItem = SHCreateItemFromParsingName(&path, None)?;
        let bin: IShellItem =
            SHGetKnownFolderItem(&FOLDERID_RecycleBinFolder, KF_FLAG_DEFAULT, None)?;
        let transfer: ITransferSource = source.GetParent()?.BindToHandler(None, &BHID_Transfer)?;
        transfer.RecycleItem(&source, &bin, TSF_NORMAL.0 as u32)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn clipes_listar(app: AppHandle) -> Result<Vec<Clip>, String> {
    let dir = crate::sidecar::replay_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || list(&dir))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn clipes_apagar(app: AppHandle, nome: String) -> Result<(), String> {
    let dir = crate::sidecar::replay_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = gallery_root(&dir).map_err(|error| error.to_string())?;
        let (path, _) = clip_path(&root, &nome).map_err(|error| error.to_string())?;
        recycle(&path)
            .map_err(|error| format!("Não foi possível enviar o clipe à Lixeira: {error}"))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Gives a saved clip a readable name ("ACE mirage R8 ..."). Both names stay inside the gallery;
/// an existing file is never replaced.
#[tauri::command]
pub async fn clipes_renomear(app: AppHandle, nome: String, novo: String) -> Result<(), String> {
    let dir = crate::sidecar::replay_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || rename(&dir, &nome, &novo))
        .await
        .map_err(|error| error.to_string())?
}

fn rename(dir: &Path, name: &str, new_name: &str) -> Result<(), String> {
    let root = gallery_root(dir).map_err(|error| error.to_string())?;
    let (path, _) = clip_path(&root, name).map_err(|error| error.to_string())?;
    let valid = !new_name.is_empty()
        && new_name.chars().count() <= 120
        && !new_name
            .chars()
            .any(|c| c.is_control() || r#"/\:*?"<>|"#.contains(c))
        && Path::new(new_name)
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("mp4"))
        && !new_name.starts_with('.');
    if !valid {
        return Err(invalid_path().to_string());
    }
    let target = root.join(new_name);
    if fs::symlink_metadata(&target).is_ok() {
        return Err("Já existe um clipe com esse nome.".into());
    }
    fs::rename(path, target).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renames_only_inside_the_gallery() {
        let videos = tempfile::tempdir().unwrap();
        let dir = videos.path().join("Stackcall");
        fs::create_dir(&dir).unwrap();
        fs::write(dir.join("clip.mp4"), b"clip").unwrap();
        fs::write(dir.join("outro.mp4"), b"clip").unwrap();
        assert!(rename(&dir, "clip.mp4", "../fora.mp4").is_err());
        assert!(rename(&dir, "clip.mp4", "a.txt").is_err());
        assert!(rename(&dir, "clip.mp4", "outro.mp4").is_err());
        rename(&dir, "clip.mp4", "ACE mirage R8 26-11 21h05.mp4").unwrap();
        assert!(dir.join("ACE mirage R8 26-11 21h05.mp4").is_file());
        assert!(!dir.join("clip.mp4").exists());
    }

    #[test]
    fn validates_direct_mp4_names() {
        let videos = tempfile::tempdir().unwrap();
        let dir = videos.path().join("Stackcall");
        fs::create_dir(&dir).unwrap();
        fs::write(dir.join("Jogo em ação.MP4"), b"clip").unwrap();
        fs::write(dir.join("outro.txt"), b"text").unwrap();
        fs::write(videos.path().join("fora.mp4"), b"clip").unwrap();
        fs::create_dir(dir.join("pasta.mp4")).unwrap();
        let root = gallery_root(&dir).unwrap();
        assert_eq!(clip_path(&root, "Jogo em ação.MP4").unwrap().1.len(), 4);
        for name in [
            "../fora.mp4",
            r"..\fora.mp4",
            "./Jogo em ação.MP4",
            "outro.txt",
            "pasta.mp4",
            "sub/clip.mp4",
            "C:clip.mp4",
            "a.mp4:stream.mp4",
            "*.mp4",
            "ausente.mp4",
        ] {
            assert!(clip_path(&root, name).is_err(), "{name}");
        }
        let outside = videos.path().join("fora.mp4");
        assert!(clip_path(&root, outside.to_str().unwrap()).is_err());
    }

    #[test]
    fn rejects_links_at_the_gallery_boundary() -> io::Result<()> {
        use std::{os::windows::fs::symlink_file, process::Command};

        let videos = tempfile::tempdir()?;
        let dir = videos.path().join("Stackcall");
        let outside = videos.path().join("Fora");
        fs::create_dir(&outside)?;
        let clip = outside.join("clip.mp4");
        fs::write(&clip, b"clip")?;
        // A junction exercises the reparse-point check without requiring elevation.
        let junction = |name| -> io::Result<()> {
            let output = Command::new("cmd.exe")
                .current_dir(videos.path())
                .args(["/d", "/c", "mklink", "/J", name, "Fora"])
                .output()?;
            assert!(output.status.success(), "{output:?}");
            Ok(())
        };
        junction("Stackcall")?;
        assert!(gallery_root(&dir).is_err());
        fs::remove_dir(&dir)?;
        fs::create_dir(&dir)?;
        if let Err(error) = symlink_file(&clip, dir.join("link.mp4")) {
            if error.raw_os_error() != Some(1314) {
                return Err(error);
            }
            junction(r"Stackcall\link.mp4")?;
        }
        assert!(clip_path(&gallery_root(&dir)?, "link.mp4").is_err());
        Ok(())
    }

    #[test]
    #[ignore = "requires an MP4 fixture and the Windows Recycle Bin"]
    fn lists_and_recycles_a_clip() {
        let fixture = std::env::var_os("STACKCALL_TEST_CLIP").unwrap();
        let videos = tempfile::tempdir().unwrap();
        let dir = videos.path().join("Stackcall");
        fs::create_dir(&dir).unwrap();
        let clip = dir.join("Jogo em ação.mp4");
        fs::copy(fixture, &clip).unwrap();
        let clips = list(&dir).unwrap();
        assert_eq!(clips.len(), 1);
        assert_eq!(clips[0].nome, "Jogo em ação.mp4");
        assert!(clips[0].duracao.is_some_and(|seconds| seconds > 0.0));
        assert!(clips[0].em > 0 && clips[0].tamanho > 0);
        recycle(&clip.canonicalize().unwrap()).unwrap();
        assert!(list(&dir).unwrap().is_empty());
    }
}
