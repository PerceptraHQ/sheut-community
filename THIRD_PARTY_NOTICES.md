# Third-party notices

Sheut Community includes compact, read-only catalog data compiled from the
official MITRE ATT&CK and MITRE ATLAS releases listed below. These notices apply
to that catalog data and do not replace Sheut Community's MPL-2.0 license.

## MITRE ATT&CK 19.1

Source: <https://github.com/mitre-attack/attack-stix-data/releases/tag/v19.1>

The MITRE Corporation (MITRE) hereby grants you a non-exclusive, royalty-free
license to use ATT&CK® for research, development, and commercial purposes. Any
copy you make for such purposes is authorized provided that you reproduce
MITRE's copyright designation and this license in any such copy.

> © 2026 The MITRE Corporation. This work is reproduced and distributed with
> the permission of The MITRE Corporation.

MITRE does not claim ATT&CK enumerates all possibilities for the types of
actions and behaviors documented as part of its adversary model and framework
of techniques. Using the information contained within ATT&CK to address or
cover full categories of techniques will not guarantee full defensive coverage
as there may be undisclosed techniques or variations on existing techniques
not documented by ATT&CK.

ALL DOCUMENTS AND THE INFORMATION CONTAINED THEREIN ARE PROVIDED ON AN "AS IS"
BASIS AND THE CONTRIBUTOR, THE ORGANIZATION HE/SHE REPRESENTS OR IS SPONSORED
BY (IF ANY), THE MITRE CORPORATION, ITS BOARD OF TRUSTEES, OFFICERS, AGENTS, AND
EMPLOYEES, DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO ANY WARRANTY THAT THE USE OF THE INFORMATION THEREIN WILL NOT
INFRINGE ANY RIGHTS OR ANY IMPLIED WARRANTIES OF MERCHANTABILITY OR FITNESS FOR
A PARTICULAR PURPOSE.

This project makes use of ATT&CK®. See the
[ATT&CK Terms of Use](https://attack.mitre.org/resources/terms-of-use/).

## MITRE ATLAS 2026.06

Source: <https://github.com/mitre-atlas/atlas-data/releases/tag/v2026.06>

Copyright 2021-2026 MITRE

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this material except in compliance with the License. You may obtain a copy of
the License at <https://www.apache.org/licenses/LICENSE-2.0>.

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.

Approved for Public Release; Distribution Unlimited. Public Release Case
Number 26-1162. ©2026 The MITRE Corporation. ALL RIGHTS RESERVED.

## OASIS STIX visualization icons

Source: <https://github.com/oasis-open/cti-stix-visualization/tree/ac8d5ba946422273a754b23b9054b3ee57c47454/stix2viz/stix2viz/icons/tiny_round_v1>

Sheut ships the exact OASIS `tiny_round_v1` STIX icon assets pinned to commit
`ac8d5ba946422273a754b23b9054b3ee57c47454`. Asset hashes and the complete
BSD-3-Clause license are included beside the source assets in
`src/assets/stix-icons`.

Copyright (c) [2016], OASIS Open. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the BSD-3-Clause conditions are met.
The software and artwork are provided "AS IS", without warranties or
conditions of any kind.

## D3 graph modules

Sheut exact-pins `d3-drag` 3.0.0, `d3-force` 3.0.0, `d3-quadtree` 3.0.1,
`d3-selection` 3.0.0, and `d3-zoom` 3.0.0 from <https://github.com/d3>.

Copyright 2010-2021 Mike Bostock

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS.

## Zustand 5.0.14

Source: <https://github.com/pmndrs/zustand>

MIT License. Copyright (c) 2019 Paul Henschel. Permission is hereby granted,
free of charge, to any person obtaining a copy of this software and associated
documentation files to deal in the Software without restriction, subject to
inclusion of the copyright and permission notice. The software is provided
"AS IS", without warranty of any kind.

## Geist and Geist Mono variable fonts

Sheut self-hosts Geist and Geist Mono through exact-pinned Fontsource variable
packages version 5.3.0. The browser loads the bundled WOFF2 assets locally;
ordinary application use does not request fonts from a network service.
PDF export embeds the regular Geist TTF from the official Geist v1.7.2 release
so exported document text remains portable and Unicode-capable.

Source: <https://github.com/vercel/geist-font>

Copyright 2024 The Geist Project Authors.

The font software is licensed under the SIL Open Font License, Version 1.1.
It may be used, studied, modified, and redistributed under the OFL conditions
and is provided "AS IS", without warranty of any kind. The complete license is
included in both installed Fontsource packages and beside the PDF font asset.

## cmdk 1.1.1

Source: <https://github.com/pacocoursey/cmdk>

MIT License. Copyright (c) Paco Coursey and contributors. Permission is hereby
granted, free of charge, to any person obtaining a copy of this software and
associated documentation files to deal in the Software without restriction,
subject to inclusion of the copyright and permission notice. The software is
provided "AS IS", without warranty of any kind.

## citationberg 0.7.0

Source: <https://github.com/typst/citationberg>

Sheut vendors the published `citationberg` 0.7.0 source used by the exact-pinned
Typst 0.15.1 renderer. The source is unchanged; its manifest selects
`quick-xml` 0.41 so the application does not ship the vulnerable 0.38 line.
The upstream MIT and Apache-2.0 license texts are included in
`vendor/citationberg`.

Copyright Martin Haug and citationberg contributors.

Licensed under either the MIT License or the Apache License, Version 2.0, at
your option. The software is provided "AS IS", without warranties or conditions
of any kind.
