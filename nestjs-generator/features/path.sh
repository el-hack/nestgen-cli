#!/bin/bash

get_cli_root() {
  echo "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
}

get_features_path() {
  echo "$(get_cli_root)/features"
}
