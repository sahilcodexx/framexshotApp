cask "framexshot" do
  version "1.1.0"

  on_arm do
    url "https://github.com/sahilcodexx/framexshotApp/releases/download/v#{version}/framexshot_#{version}_aarch64.dmg"
    sha256 "1131178c3423fd2da7e0593da77a6483b4b800a37d182a0da616ee0cb4fd0781"
  end
  on_intel do
    url "https://github.com/sahilcodexx/framexshotApp/releases/download/v#{version}/framexshot_#{version}_x64.dmg"
    sha256 "fd242dff75cd9ca5bc64d4e4937753960ac3f0484f600020c27ebe23547c0f44"
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
