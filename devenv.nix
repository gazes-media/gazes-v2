{ pkgs, lib, config, inputs, ... }:

{

  # https://devenv.sh/packages/
  packages = [ pkgs.git pkgs.bun ];

  # https://devenv.sh/languages/
  languages.javascript.enable = true;


}
