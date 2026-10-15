/* Publicly announced guarantees known by each selected starting season.
   AAV is modeled evenly: bonuses, deferrals, options and opt-outs are NOT modeled.
   Unlisted deals are generated and labeled, never presented as historical facts. */
(function(root) {
  const contracts = [
    { id:592450,known:2023,start:2023,end:2031,total:360000000,source:'https://www.mlb.com/athletics/news/aaron-judge-signs-nine-year-contract-with-yankees' },
    { id:660271,known:2024,start:2024,end:2033,total:700000000,source:'https://www.mlb.com/news/shohei-ohtani-contract-with-dodgers',note:'Nominal AAV; $680m deferred in the actual deal. Deferral cash flows are not modeled.' },
    { id:545361,known:2019,start:2019,end:2030,total:426500000,source:'https://www.mlb.com/news/mike-trout-angels-deal' },
    { id:605141,known:2020,start:2021,end:2032,total:365000000,source:'https://www.mlb.com/news/mookie-betts-extension-with-dodgers' }
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports=contracts;
  else root.StartingContracts=contracts;
})(typeof window!=='undefined'?window:globalThis);
