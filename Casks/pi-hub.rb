cask "pi-hub" do
  version "1.3.0"

  on_arm do
    sha256 "72a5ab374cadd2fcd9458ff68b51f37863ac83a3c2b9fb1975d58c041c5a9e32"
    url "https://github.com/lllll081926i/pihub/releases/download/v#{version}/PiHub_1.3.0_aarch64.dmg",
        verified: "github.com/lllll081926i/pihub/"
  end

  on_intel do
    sha256 "8c0c5e3abbb28a79ac63885d671affb8676bec9afedf2774ebd4ecf21a92ebd5"
    url "https://github.com/lllll081926i/pihub/releases/download/v#{version}/PiHub_1.3.0_x64.dmg",
        verified: "github.com/lllll081926i/pihub/"
  end

  name "PiHub"
  desc "Desktop toolbox for managing AI coding assistant configurations"
  homepage "https://github.com/lllll081926i/pihub"

  app "PiHub.app"
end
