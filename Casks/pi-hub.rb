cask "pi-hub" do
  version "1.2.0"

  on_arm do
    sha256 "9971275c820e94f422a9ac126bd11543c25cc230bcba71ae3f14472ea376de2b"
    url "https://github.com/lllll081926i/pihub/releases/download/v#{version}/PiHub_1.2.0_aarch64.dmg",
        verified: "github.com/lllll081926i/pihub/"
  end

  on_intel do
    sha256 "7bfdf2c32cb734deab074df96fdbf4852f7ce6fed8220b2a23836e18bcd9b5df"
    url "https://github.com/lllll081926i/pihub/releases/download/v#{version}/PiHub_1.2.0_x64.dmg",
        verified: "github.com/lllll081926i/pihub/"
  end

  name "PiHub"
  desc "Desktop toolbox for managing AI coding assistant configurations"
  homepage "https://github.com/lllll081926i/pihub"

  app "PiHub.app"
end
