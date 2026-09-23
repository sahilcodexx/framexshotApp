cask "framexshot" do
  version "1.2.0"

  on_arm do
    url "https://github.com/sahilcodexx/framexshotApp/releases/download/v#{version}/framexshot_#{version}_aarch64.dmg"
    sha256 "9b82f69914284ae0a93292743aae109f41bd3b11c09be8dbc0efedc6b7d642fa"
  end
  on_intel do
    url "https://github.com/sahilcodexx/framexshotApp/releases/download/v#{version}/framexshot_#{version}_x64.dmg"
    sha256 "228943e962c792ad293168d1f5cdc139f65b0ea900b8c6ad079d7eed60fd02cf"
  end

  name "FrameXShot"
  desc "Cross-platform screenshot tool with editor, backgrounds and annotations"
  homepage "https://github.com/sahilcodexx/framexshotApp"

  livecheck do
    url "https://github.com/sahilcodexx/framexshotApp/releases/latest"
    strategy :github_latest
  end

  depends_on macos: ">= :catalina"

  app "framexshot.app"

  # The release DMGs are unsigned, and Homebrew deliberately quarantines cask
  # downloads — without this, Gatekeeper blocks the first launch with
  # "framexshot is damaged and can't be opened". Strip the quarantine
  # attribute from both the staged copy and the installed app so
  # `brew install --cask framexshot` needs no manual `xattr` step.
  postflight do
    system_command "/usr/bin/xattr",
                   args:         ["-cr", "#{staged_path}/framexshot.app"],
                   must_succeed: false
    system_command "/usr/bin/xattr",
                   args:         ["-cr", "#{appdir}/framexshot.app"],
                   must_succeed: false
  end

  zap trash: [
    "~/Library/Preferences/com.framexshot.app.plist",
    "~/Library/Application Support/com.framexshot.app",
    "~/Library/Caches/com.framexshot.app",
    "~/Library/Logs/com.framexshot.app",
    "~/Library/WebKit/com.framexshot.app",
    "~/Library/Saved Application State/com.framexshot.app.savedState",
  ]
end
