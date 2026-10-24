# VS-00I 真实单调用入口；配置只作用于本次 BEAM，不写桌面设置或全局配置。
# bash scripts/probe_run.sh scripts/model_contracts/prompt_prefix_live.exs all 1
# PREFIX_PROBE_PROFILE_DIR 指向既有桌面 profile；凭据不进入报告。
# PREFIX_PROBE_LABEL 区分 baseline / after；PREFIX_PROBE_MODE=single 仅首个单调用。
Code.require_file("prompt_prefix_probe.exs", __DIR__)
ModelContracts.PromptPrefixProbe.main(System.argv())
