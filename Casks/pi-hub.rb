cask "pi-hub" do
  version "1.2.1"

  on_arm do
    sha256 "d0885b1c730ef737b56ba4c634f5bf026f36852cbb3ee02b265e1d2285819c79"
    url "https://github.com/lllll081926i/pihub/releases/download/v#{version}/PiHub_1.2.1_aarch64.dmg",
        verified: "github.com/lllll081926i/pihub/"
  end

  on_intel do
    sha256 "ffb5ec22848d97518c96faf527187d7b7c3c3e8330da34357f0c54c55fcb5c0d"
    url "https://github.com/lllll081926i/pihub/releases/download/v#{version}/PiHub_1.2.1_x64.dmg",
        verified: "github.com/lllll081926i/pihub/"
  end

  name "PiHub"
  desc "Desktop toolbox for managing AI coding assistant configurations"
  homepage "https://github.com/lllll081926i/pihub"

  app "PiHub.app"
end
