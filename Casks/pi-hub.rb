cask "pi-hub" do
  version "1.4.0"

  on_arm do
    sha256 "9e6a1b0024a50502d5f36732ea16a9ebfa1854122716bb1b5323e66c55711f2e"
    url "https://github.com/lllll081926i/pihub/releases/download/v#{version}/PiHub_1.4.0_aarch64.dmg",
        verified: "github.com/lllll081926i/pihub/"
  end

  on_intel do
    sha256 "5024e9d2e55f89b63e1290eb8ce51e4cc85212c2edadb37a828c05b0e9528708"
    url "https://github.com/lllll081926i/pihub/releases/download/v#{version}/PiHub_1.4.0_x64.dmg",
        verified: "github.com/lllll081926i/pihub/"
  end

  name "PiHub"
  desc "Desktop toolbox for managing AI coding assistant configurations"
  homepage "https://github.com/lllll081926i/pihub"

  app "PiHub.app"
end
