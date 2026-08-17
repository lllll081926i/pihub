cask "pi-hub" do
  version "1.4.1"

  on_arm do
    sha256 "7a65867467568ab9e71b09c3c228b95a037bd6e82365fcd005fc0a8143ae53c9"
    url "https://github.com/lllll081926i/pihub/releases/download/v#{version}/PiHub_1.4.1_aarch64.dmg",
        verified: "github.com/lllll081926i/pihub/"
  end

  on_intel do
    sha256 "137dbf0bfb29db0c305cf886adc35841efba2ee85992d6471d749f287adf1636"
    url "https://github.com/lllll081926i/pihub/releases/download/v#{version}/PiHub_1.4.1_x64.dmg",
        verified: "github.com/lllll081926i/pihub/"
  end

  name "PiHub"
  desc "Desktop toolbox for managing AI coding assistant configurations"
  homepage "https://github.com/lllll081926i/pihub"

  app "PiHub.app"
end
