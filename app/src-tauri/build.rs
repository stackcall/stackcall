// Every app command is declared here, so a window may call only what its capability allows
// (capabilities/default.json for the main window; the "falantes" window gets none).
const COMMANDS: &[&str] = &[
    "atalhos_definir",
    "atalhos_gravar",
    "remote_changelog",
    "api",
    "sessao_existe",
    "modo_jogo_atual",
    "falantes_abrir",
    "falantes_fechar",
    "falantes_posicionar",
    "falantes_redimensionar",
    "gsi_cs2_localizar",
    "gsi_cs2_instalar",
    "presenca_jogo_atual",
    "listar_fontes",
    "testar_maquina",
    "iniciar_transmissao",
    "parar_transmissao",
    "mudar_bitrate",
    "mudar_pausa_transmissao",
    "mudar_faixa_leve",
    "replay_definir",
    "replay_atual",
    "replay_microfone",
    "replay_salvar",
    "clipes_listar",
    "clipes_apagar",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
